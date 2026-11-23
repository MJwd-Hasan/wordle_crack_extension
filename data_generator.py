import csv
import nltk
nltk.download('words', quiet=True)
from nltk.corpus import words
import numpy as np

five_letter_words = sorted(set(
    w.lower() for w in words.words() if len(w) == 5 and w.isalpha()
))

GUESS1 = 'salet'
GUESS2 = 'crony'
NUM_SIMULATIONS = 8000
OUTPUT_CSV = 'wordle_8000_simulations.csv'

def guesser(
    guess: str,
    word_of_the_day: str,
) -> list[str]:
    guess = guess.lower()
    feedback = []
    for i in range(len(guess)):
        if guess[i] == word_of_the_day[i]:
            feedback.append('G')
        elif guess[i] in word_of_the_day:
            feedback.append('Y')
        else:
            feedback.append('B')
    return feedback

def filter_words(
    guess: str,
    feedback: list[str],
    candidates: list[str],
) -> list[str]:
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

def simulate_game(
    word_of_the_day: str,
    all_words: list[str],
) -> dict:
    filtered_words = all_words
    solved = False
    attempts_used = 0
    row = {
        'target_word': word_of_the_day,
        'solved': False,
        'attempts': 6,
    }
    for k in range(1, 7):
        row[f'guess_{k}'] = ''
        row[f'feedback_{k}'] = ''
        row[f'remaining_{k}'] = ''

    for attempt, guess in enumerate([GUESS1, GUESS2], start=1):
        attempts_used = attempt
        fb = guesser(guess, word_of_the_day)
        row[f'guess_{attempt}'] = guess
        row[f'feedback_{attempt}'] = ''.join(fb)
        if guess == word_of_the_day:
            row[f'remaining_{attempt}'] = 1
            solved = True
            break
        filtered_words = filter_words(guess, fb, filtered_words)
        row[f'remaining_{attempt}'] = len(filtered_words)

    if not solved:
        for attempt in range(3, 7):
            attempts_used = attempt
            guess = str(np.random.choice(filtered_words))
            fb = guesser(guess, word_of_the_day)
            row[f'guess_{attempt}'] = guess
            row[f'feedback_{attempt}'] = ''.join(fb)
            if guess == word_of_the_day:
                row[f'remaining_{attempt}'] = 1
                solved = True
                break
            filtered_words = filter_words(guess, fb, filtered_words)
            row[f'remaining_{attempt}'] = len(filtered_words)

    row['solved'] = solved
    row['attempts'] = attempts_used
    return row

sample_words = np.random.choice(
    five_letter_words,
    size=min(NUM_SIMULATIONS, len(five_letter_words)),
    replace=False,
)

fieldnames = ['target_word', 'solved', 'attempts']
for k in range(1, 7):
    fieldnames.extend([f'guess_{k}', f'feedback_{k}', f'remaining_{k}'])

solved_count = 0
with open(OUTPUT_CSV, mode='w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    for target in sample_words:
        result = simulate_game(str(target), five_letter_words)
        if result['solved']:
            solved_count += 1
        writer.writerow(result)

print(f'Saved {len(sample_words)} simulations to {OUTPUT_CSV}')
print(f'Win rate: {solved_count / len(sample_words) * 100:.2f}% ({solved_count}/{len(sample_words)})')