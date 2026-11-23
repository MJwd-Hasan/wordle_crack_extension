import nltk
nltk.download('words')
from nltk.corpus import words
import numpy as np

five_letter_words = sorted(set(
    w.lower() for w in words.words() if len(w) == 5 and w.isalpha()
))

print(f'Available five-letter words: {len(five_letter_words)}')

word_of_the_day = np.random.choice(five_letter_words, size=1, replace=False)[0]

print(f'Word of the day: {word_of_the_day}')

GUESS1 = 'salet'
GUESS2 = 'crony'

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

filtered_words = five_letter_words
solved = False

for attempt, guess in enumerate([GUESS1, GUESS2], start=1):
    fb = guesser(guess, word_of_the_day)
    print(f'Guess {attempt} ("{guess}") feedback: {fb}')
    if guess == word_of_the_day:
        print(f'"{guess}" was the word of the day! Solved in {attempt} guesses.')
        solved = True
        break
    filtered_words = filter_words(guess, fb, filtered_words)
    print(f'Filtered words after guess {attempt} ("{guess}"): {len(filtered_words)}')

if not solved:
    for attempt in range(3, 7):
        guess = np.random.choice(filtered_words)
        print(f'Guess {attempt} chosen from memory: {guess}')
        fb = guesser(guess, word_of_the_day)
        print(f'Guess {attempt} ("{guess}") feedback: {fb}')
        if guess == word_of_the_day:
            print(f'"{guess}" was the word of the day! Solved in {attempt} guesses.')
            solved = True
            break
        filtered_words = filter_words(guess, fb, filtered_words)
        print(f'Filtered words after guess {attempt} ("{guess}"): {len(filtered_words)}')

if not solved:
    print(f'Failed to guess in 6 tries. The word of the day was: {word_of_the_day}')