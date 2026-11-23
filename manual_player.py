from collections import Counter
import nltk
nltk.download('words', quiet=True)
from nltk.corpus import words

candidates = sorted(set(
    w.lower() for w in words.words() if len(w) == 5 and w.isalpha()
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

print(f'Loaded {len(candidates)} words. Type "exit" to quit.\n')

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

    candidates = filter_words(guess, feedback, candidates)
    print(f'\nWord: {guess} | Feedback: {feedback} | Remaining: {len(candidates)}')
    print('Shortlisted words:', ', '.join(candidates), '\n')
    attempt += 1