import math
from collections import Counter
import nltk
nltk.download('words', quiet=True)
from nltk.corpus import words
import numpy as np
import pandas as pd
import torch
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

CSV_PATH = 'wordle_8000_simulations.csv'
MODEL_NAME = 'google/flan-t5-small'
SAVE_DIR = './wordle_flan_t5'
EPOCHS = 3
BATCH_SIZE = 32
LR = 3e-4

device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

def guesser(guess: str, target: str) -> str:
    guess = guess.lower()
    target = target.lower()
    feedback = []
    for i in range(5):
        if guess[i] == target[i]:
            feedback.append('G')
        elif guess[i] in target:
            feedback.append('Y')
        else:
            feedback.append('B')
    return ''.join(feedback)

def filter_words(guess: str, feedback: str, candidates: list[str]) -> list[str]:
    guess = guess.lower()
    shortlisted = []
    for word in candidates:
        valid = True
        for i, (char, fb) in enumerate(zip(guess, feedback)):
            if fb == 'G':
                if word[i] != char:
                    valid = False
                    break
            elif fb == 'Y':
                if word[i] == char or char not in word:
                    valid = False
                    break
            elif fb == 'B':
                if char in word:
                    valid = False
                    break
        if valid:
            shortlisted.append(word)
    return shortlisted

def build_prompt(history: list[tuple[str, str]]) -> str:
    if not history:
        return 'wordle next guess: start'
    turns = ' | '.join(f'{g}:{fb}' for g, fb in history)
    return f'wordle next guess: {turns}'

def load_vocab_and_pairs(csv_path: str) -> tuple[list[str], list[str], list[str]]:
    df = pd.read_csv(csv_path)
    vocab = set(w.lower() for w in words.words() if len(w) == 5 and w.isalpha())
    vocab.update(df['target_word'].dropna().astype(str).str.lower())
    for k in range(1, 7):
        vocab.update(df[f'guess_{k}'].dropna().astype(str).str.lower())
    vocab = sorted(w for w in vocab if len(w) == 5 and w.isalpha())

    prompts = []
    targets = []
    solved_df = df[df['solved'] == True]
    for _, row in solved_df.iterrows():
        history = []
        target_word = str(row['target_word']).lower()
        for k in range(1, 7):
            g = row[f'guess_{k}']
            fb = row[f'feedback_{k}']
            if pd.isna(g) or pd.isna(fb):
                break
            g = str(g).lower()
            fb = str(fb)
            if k >= 3:
                prompts.append(build_prompt(history))
                targets.append(target_word)
            history.append((g, fb))
            if g == target_word:
                break
    return vocab, prompts, targets

class WordleDataset(Dataset):
    def __init__(self, prompts: list[str], targets: list[str]):
        self.prompts = prompts
        self.targets = targets

    def __len__(self) -> int:
        return len(self.prompts)

    def __getitem__(self, idx: int) -> tuple[str, str]:
        return self.prompts[idx], self.targets[idx]

def train_model(prompts: list[str], targets: list[str]):
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME).to(device)

    def collate_fn(batch):
        batch_prompts, batch_targets = zip(*batch)
        enc = tokenizer(
            list(batch_prompts),
            padding=True,
            truncation=True,
            max_length=128,
            return_tensors='pt',
        )
        labels = tokenizer(
            list(batch_targets),
            padding=True,
            truncation=True,
            max_length=16,
            return_tensors='pt',
        ).input_ids
        labels[labels == tokenizer.pad_token_id] = -100
        return enc.input_ids, enc.attention_mask, labels

    dataset = WordleDataset(prompts, targets)
    loader = DataLoader(dataset, batch_size=BATCH_SIZE, shuffle=True, collate_fn=collate_fn)
    optimizer = torch.optim.AdamW(model.parameters(), lr=LR)

    model.train()
    for epoch in range(1, EPOCHS + 1):
        total_loss = 0.0
        for input_ids, attention_mask, labels in loader:
            input_ids = input_ids.to(device)
            attention_mask = attention_mask.to(device)
            labels = labels.to(device)
            outputs = model(
                input_ids=input_ids,
                attention_mask=attention_mask,
                labels=labels,
            )
            loss = outputs.loss
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
        print(f'Epoch {epoch}/{EPOCHS} - Loss: {total_loss / len(loader):.4f}')

    model.save_pretrained(SAVE_DIR)
    tokenizer.save_pretrained(SAVE_DIR)
    model.eval()
    return model, tokenizer

def positional_frequency_rank(candidates: list[str], top_k: int = 80) -> list[str]:
    if len(candidates) <= top_k:
        return candidates
    pos_counts = [Counter(w[i] for w in candidates) for i in range(5)]
    char_counts = Counter(c for w in candidates for c in set(w))
    def score(word: str) -> float:
        return sum(pos_counts[i][word[i]] for i in range(5)) + 0.5 * sum(char_counts[c] for c in set(word))
    return sorted(candidates, key=score, reverse=True)[:top_k]

def calc_entropy(guess: str, candidates: list[str]) -> float:
    n = len(candidates)
    if n <= 1:
        return 0.0
    counts = Counter(guesser(guess, c) for c in candidates)
    entropy = 0.0
    for count in counts.values():
        p = count / n
        entropy -= p * math.log2(p)
    return entropy

def score_candidates_with_llm(
    model,
    tokenizer,
    prompt: str,
    candidates: list[str],
) -> list[float]:
    enc = tokenizer(
        [prompt] * len(candidates),
        padding=True,
        truncation=True,
        max_length=128,
        return_tensors='pt',
    ).to(device)
    labels = tokenizer(
        candidates,
        padding=True,
        truncation=True,
        max_length=16,
        return_tensors='pt',
    ).input_ids.to(device)
    labels[labels == tokenizer.pad_token_id] = -100

    with torch.no_grad():
        outputs = model(
            input_ids=enc.input_ids,
            attention_mask=enc.attention_mask,
            labels=labels,
        )
        logits = outputs.logits
        loss_per_token = F.cross_entropy(
            logits.view(-1, logits.size(-1)),
            labels.view(-1),
            ignore_index=-100,
            reduction='none',
        ).view(labels.size(0), -1)
        mask = (labels != -100).float()
        scores = -(loss_per_token.sum(dim=1) / mask.sum(dim=1).clamp(min=1.0))
    return scores.cpu().tolist()

def normalize(values: list[float]) -> list[float]:
    lo = min(values)
    hi = max(values)
    if hi - lo < 1e-9:
        return [1.0] * len(values)
    return [(v - lo) / (hi - lo) for v in values]

def pick_next_guess(
    model,
    tokenizer,
    history: list[tuple[str, str]],
    candidates: list[str],
    attempt: int,
) -> str:
    if attempt == 1:
        return 'salet'
    if len(candidates) == 1:
        return candidates[0]
    prompt = build_prompt(history)
    if len(candidates) == 0:
        enc = tokenizer(prompt, return_tensors='pt').to(device)
        with torch.no_grad():
            out = model.generate(**enc, max_new_tokens=8)
        pred = tokenizer.decode(out[0], skip_special_tokens=True).strip().lower()
        return pred[:5] if len(pred) >= 5 else 'crony'
    if len(candidates) == 2:
        llm_scores = score_candidates_with_llm(model, tokenizer, prompt, candidates)
        return candidates[int(np.argmax(llm_scores))]

    pool = positional_frequency_rank(candidates, top_k=80)
    entropies = [calc_entropy(w, candidates) for w in pool]
    top_indices = np.argsort(entropies)[::-1][:15]
    top_words = [pool[i] for i in top_indices]
    top_entropies = [entropies[i] for i in top_indices]

    llm_scores = score_candidates_with_llm(model, tokenizer, prompt, top_words)
    norm_ent = normalize(top_entropies)
    norm_llm = normalize(llm_scores)
    combined = [0.75 * e + 0.25 * l for e, l in zip(norm_ent, norm_llm)]
    return top_words[int(np.argmax(combined))]

def solve_word(
    target: str,
    vocab: list[str],
    model,
    tokenizer,
) -> None:
    target = target.lower()
    candidates = list(vocab)
    if target not in candidates:
        candidates.append(target)
    history = []
    solved = False

    print(f'\nTarget Word: {target}')
    for attempt in range(1, 7):
        guess = pick_next_guess(model, tokenizer, history, candidates, attempt)
        fb = guesser(guess, target)
        history.append((guess, fb))
        if guess == target:
            print(f'Guess {attempt}: {guess} | Feedback: {fb} | Remaining: 1')
            print(f'Solved "{target}" in {attempt} guesses.')
            solved = True
            break
        candidates = filter_words(guess, fb, candidates)
        print(f'Guess {attempt}: {guess} | Feedback: {fb} | Remaining: {len(candidates)}')

    if not solved:
        print(f'Failed to solve "{target}" within 6 guesses.')

vocab, prompts, targets = load_vocab_and_pairs(CSV_PATH)
print(f'Loaded {len(vocab)} words and {len(prompts)} training examples from {CSV_PATH}')
model, tokenizer = train_model(prompts, targets)

while True:
    user_word = input('\nEnter a 5-letter word to test (or "quit" to exit): ').strip().lower()
    if user_word == 'quit':
        break
    if len(user_word) != 5 or not user_word.isalpha():
        print('Invalid input. Please enter a 5-letter alphabetic word.')
        continue
    solve_word(user_word, vocab, model, tokenizer)