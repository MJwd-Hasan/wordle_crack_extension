from collections import Counter
import nltk
nltk.download('words', quiet=True)
from nltk.corpus import words
from collections import Counter
from wordfreq import top_n_list

candidates = sorted(set(
    w.lower() for w in top_n_list('en', 50000) if len(w) == 5 and w.isalpha()
))

def get_feedback(guess: str, candidate: str) -> str:
    result = ['B'] * 5
    remaining = Counter(candidate)
    for i in range(5):
        if guess[i] == candidate[i]:
            result[i] = 'G'
            remaining[guess[i]] -= 1
    for i in range(5):
        if result[i] == 'B' and remaining[guess[i]] > 0:
            result[i] = 'Y'
            remaining[guess[i]] -= 1
    return ''.join(result)

def filter_words(guess: str, feedback: str, current_list: list[str]) -> list[str]:
    return [word for word in current_list if get_feedback(guess, word) == feedback]

def compute_letter_probabilities(current_list: list[str], black_letters: set[str]) -> tuple[dict[str, float], list[dict[str, float]]]:
    n = len(current_list)
    if n == 0:
        return {}, [{} for _ in range(5)]
    overall_counts = Counter(c for w in current_list for c in set(w))
    overall_probs = {
        ch: (0.0 if ch in black_letters else overall_counts[ch] / n)
        for ch in overall_counts
    }
    pos_probs = []
    for i in range(5):
        pos_counts = Counter(w[i] for w in current_list)
        pos_probs.append({
            ch: (0.0 if ch in black_letters else pos_counts[ch] / n)
            for ch in pos_counts
        })
    return overall_probs, pos_probs

def score_candidates(
    current_list: list[str],
    overall_probs: dict[str, float],
    pos_probs: list[dict[str, float]],
) -> list[tuple[str, float]]:
    if not current_list:
        return []
    raw_scores = []
    for word in current_list:
        pos_score = sum(pos_probs[i].get(word[i], 0.0) for i in range(5)) / 5.0
        unique_score = sum(overall_probs.get(c, 0.0) for c in set(word)) / 5.0
        raw_scores.append((word, 0.6 * pos_score + 0.4 * unique_score))
    total = sum(score for _, score in raw_scores)
    if total <= 0:
        equal_weight = 100.0 / len(current_list)
        return [(word, equal_weight) for word in current_list]
    weighted = [(word, (score / total) * 100.0) for word, score in raw_scores]
    weighted.sort(key=lambda x: x[1], reverse=True)
    return weighted

print(f'Loaded {len(candidates)} words. Type "exit" to quit.\n')

black_letters: set[str] = set()
confirmed_letters: set[str] = set()
attempt = 1

while True:
    guess = input(f'Guess {attempt} word: ').strip().lower()
    if guess == 'exit':
        break
    if len(guess) != 5 or not guess.isalpha():
        print('Enter a valid 5-letter word.\n')
        continue

    feedback = input(f'Guess {attempt} feedback (G/Y/B): ').strip().upper()
    if feedback.lower() == 'exit':
        break
    if len(feedback) != 5 or any(c not in 'GYB' for c in feedback):
        print('Enter 5 characters using only G, Y, or B.\n')
        continue

    for ch, fb in zip(guess, feedback):
        if fb in ('G', 'Y'):
            confirmed_letters.add(ch)
            black_letters.discard(ch)
        elif fb == 'B' and ch not in confirmed_letters:
            black_letters.add(ch)

    candidates = filter_words(guess, feedback, candidates)
    print(f'\nWord: {guess} | Feedback: {feedback} | Remaining: {len(candidates)}')
    print('Black (eliminated) letters:', ', '.join(sorted(black_letters)) if black_letters else 'None')

    if len(candidates) == 0:
        print('No matching words found. Check your inputs.\n')
        break

    overall_probs, pos_probs = compute_letter_probabilities(candidates, black_letters)
    ranked_letters = sorted(
        [(ch, prob * 100.0) for ch, prob in overall_probs.items() if prob > 0],
        key=lambda x: x[1],
        reverse=True,
    )
    print('Letter probabilities:', ', '.join(f'{ch}: {p:.1f}%' for ch, p in ranked_letters[:15]))

    ranked_words = score_candidates(candidates, overall_probs, pos_probs)
    top_display = ranked_words[:25]
    print('Weighted shortlist:', ', '.join(f'{w} ({p:.2f}%)' for w, p in top_display))
    if len(ranked_words) > 25:
        print(f'... and {len(ranked_words) - 25} more words')
    print()

    if feedback == 'GGGGG':
        print(f'Solved "{guess}" in {attempt} guesses.')
        break

    attempt += 1