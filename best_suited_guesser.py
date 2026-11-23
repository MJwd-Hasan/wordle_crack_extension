import nltk
nltk.download('words', quiet=True)
from nltk.corpus import words
from collections import defaultdict
import numpy as np

five_letter_words = sorted(set(
    w.lower() for w in words.words() if len(w) == 5 and w.isalpha()
))

def get_feedback(guess, target):
    result = [0] * 5
    target_chars = list(target)
    for i in range(5):
        if guess[i] == target_chars[i]:
            result[i] = 2
            target_chars[i] = None
    for i in range(5):
        if result[i] == 0 and guess[i] in target_chars:
            result[i] = 1
            target_chars[target_chars.index(guess[i])] = None
    return tuple(result)

def benchmark_combo(guesses, targets, word_pool):
    buckets = []
    for guess in guesses:
        b = defaultdict(set)
        for w in word_pool:
            b[get_feedback(guess, w)].add(w)
        buckets.append(b)

    remaining_counts = {1: [], 2: [], 3: []}
    for target in targets:
        candidates = buckets[0][get_feedback(guesses[0], target)]
        remaining_counts[1].append(len(candidates))
        candidates = candidates & buckets[1][get_feedback(guesses[1], target)]
        remaining_counts[2].append(len(candidates))
        candidates = candidates & buckets[2][get_feedback(guesses[2], target)]
        remaining_counts[3].append(len(candidates))

    return {step: np.array(vals) for step, vals in remaining_counts.items()}

np.random.seed(42)
num_simulations = 1000
targets = np.random.choice(five_letter_words, size=num_simulations, replace=True)

combo_a = ['cater', 'booly', 'fungi']
combo_b = ['salet', 'crony', 'humid']

res_a = benchmark_combo(combo_a, targets, five_letter_words)
res_b = benchmark_combo(combo_b, targets, five_letter_words)

print(f'Side-by-Side Benchmark across {num_simulations} Same Random Targets (Pool: {len(five_letter_words)} words)\n')
header = f"{'Step':<8} | {'Combo A (cater/booly/fungi)':<36} | {'Combo B (salet/crony/humid)':<36}"
print(header)
print('-' * len(header))

for step in [1, 2, 3]:
    a = res_a[step]
    b = res_b[step]
    a_str = f"Avg:{np.mean(a):6.2f} Med:{np.median(a):4.1f} 1-Left:{np.mean(a == 1)*100:5.1f}%"
    b_str = f"Avg:{np.mean(b):6.2f} Med:{np.median(b):4.1f} 1-Left:{np.mean(b == 1)*100:5.1f}%"
    print(f"Guess {step:<2} | {a_str:<36} | {b_str:<36}")

print('-' * len(header))
a_wins = np.sum(res_a[3] < res_b[3])
b_wins = np.sum(res_b[3] < res_a[3])
ties = np.sum(res_a[3] == res_b[3])
print(f"Head-to-Head after Guess 3 -> Combo A better: {a_wins} | Combo B better: {b_wins} | Ties: {ties}")