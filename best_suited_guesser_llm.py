#!/usr/bin/env python3
"""
Exhaustive opening-guesser tournament for the FLAN-T5 Wordle strategy.

For every opening word in the guess vocabulary, simulate it against every target
word in the answer vocabulary. Subsequent guesses follow llm.py's strategy:
candidate positional-frequency shortlist -> entropy shortlist -> FLAN-T5 scoring
(when a local model is available) -> weighted blend. Exact Wordle feedback with
duplicate-letter handling is used throughout.

CPU-friendly features: precomputed feedback codes, memoized decision states,
batched model scoring, progress checkpoints, resumability, and CSV/JSON reports.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import random
import json
import math
import os
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable

import numpy as np

try:
    import nltk
    from nltk.corpus import words as nltk_words
except ImportError:
    nltk = None
    nltk_words = None

try:
    import pandas as pd
except ImportError:
    pd = None

try:
    import torch
    import torch.nn.functional as F
    from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
except ImportError:
    torch = None
    F = None
    AutoTokenizer = AutoModelForSeq2SeqLM = None

DEFAULT_CSV = "wordle_8000_simulations.csv"
DEFAULT_MODEL_DIR = "wordle_flan_t5"
GREEN, YELLOW, GRAY = 2, 1, 0
FEEDBACK_BASE = 3
MAX_GUESSES = 6


def valid_word(w: str) -> bool:
    return len(w) == 5 and w.isalpha() and w.isascii()


def feedback_code(guess: str, target: str) -> int:
    """Encode exact Wordle feedback as a base-3 integer; handles duplicates."""
    marks = [GRAY] * 5
    remaining = Counter(target)
    for i, c in enumerate(guess):
        if c == target[i]:
            marks[i] = GREEN
            remaining[c] -= 1
    for i, c in enumerate(guess):
        if marks[i] == GREEN:
            continue
        if remaining[c] > 0:
            marks[i] = YELLOW
            remaining[c] -= 1
    value = 0
    for mark in marks:
        value = value * FEEDBACK_BASE + mark
    return value


def decode_feedback(code: int) -> str:
    chars = ["B"] * 5
    for i in range(4, -1, -1):
        mark = code % FEEDBACK_BASE
        code //= FEEDBACK_BASE
        chars[i] = "G" if mark == GREEN else "Y" if mark == YELLOW else "B"
    return "".join(chars)


def load_vocab(csv_path: str | None, extra_words: Iterable[str] = ()) -> list[str]:
    vocab: set[str] = set()
    if nltk_words is not None:
        try:
            vocab.update(w.lower() for w in nltk_words.words() if valid_word(w))
        except LookupError:
            print("NLTK word corpus missing. Downloading 'words' corpus...", flush=True)
            nltk.download("words", quiet=False)
            vocab.update(w.lower() for w in nltk_words.words() if valid_word(w))
    else:
        print("Warning: NLTK unavailable; vocabulary will use CSV words and supplied extras.", file=sys.stderr)
    vocab.update(w.lower().strip() for w in extra_words if valid_word(w.strip()))
    if csv_path and Path(csv_path).is_file():
        if pd is None:
            with open(csv_path, newline="", encoding="utf-8") as f:
                rows = list(csv.DictReader(f))
            for row in rows:
                for key, value in row.items():
                    if key and (key.startswith("guess_") or key == "target_word") and value:
                        word = value.lower().strip()
                        if valid_word(word):
                            vocab.add(word)
        else:
            df = pd.read_csv(csv_path)
            columns = [c for c in df.columns if c == "target_word" or c.startswith("guess_")]
            for c in columns:
                vocab.update(w.lower() for w in df[c].dropna().astype(str) if valid_word(w))
    return sorted(vocab)


class LLMScorer:
    """Local FLAN-T5 scorer with CPU-only support and batched sequence loss."""
    def __init__(self, model_dir: str, batch_size: int = 32, device: str = "auto"):
        self.model = self.tokenizer = None
        self.batch_size = batch_size
        self.device = "cpu"
        if torch is None or AutoTokenizer is None:
            print("Torch/transformers not installed; using entropy-only continuation.", file=sys.stderr)
            return
        path = Path(model_dir)
        if not path.exists():
            print(f"Model folder not found ({model_dir}); entropy-only continuation.", file=sys.stderr)
            return
        if device == "auto":
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            self.device = device
        if self.device == "cpu":
            # R7 5700X benefits from moderate parallelism; avoid oversubscription.
            n = max(1, min(12, os.cpu_count() or 8))
            torch.set_num_threads(n)
        print(f"Loading local model from {model_dir} on {self.device}...", flush=True)
        self.tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True)
        self.model = AutoModelForSeq2SeqLM.from_pretrained(model_dir, local_files_only=True).to(self.device)
        self.model.eval()

    @property
    def available(self) -> bool:
        return self.model is not None

    def score(self, prompt: str, candidates: list[str]) -> list[float]:
        if not candidates or not self.available:
            return [0.0] * len(candidates)
        out_scores: list[float] = []
        for start in range(0, len(candidates), self.batch_size):
            batch = candidates[start:start + self.batch_size]
            enc = self.tokenizer([prompt] * len(batch), padding=True, truncation=True,
                                 max_length=128, return_tensors="pt").to(self.device)
            labels = self.tokenizer(batch, padding=True, truncation=True, max_length=16,
                                    return_tensors="pt").input_ids.to(self.device)
            labels[labels == self.tokenizer.pad_token_id] = -100
            with torch.inference_mode():
                logits = self.model(input_ids=enc.input_ids, attention_mask=enc.attention_mask,
                                   labels=labels).logits
                losses = F.cross_entropy(logits.reshape(-1, logits.size(-1)),
                                        labels.reshape(-1), ignore_index=-100,
                                        reduction="none").reshape(labels.shape)
                mask = (labels != -100).float()
                scores = -(losses.sum(dim=1) / mask.sum(dim=1).clamp(min=1.0))
            out_scores.extend(scores.cpu().tolist())
        return out_scores


def norm(values: list[float]) -> list[float]:
    if not values:
        return []
    lo, hi = min(values), max(values)
    if hi - lo < 1e-12:
        return [1.0] * len(values)
    return [(v - lo) / (hi - lo) for v in values]


def positional_rank(candidates: list[str], limit: int = 80) -> list[str]:
    if len(candidates) <= limit:
        return candidates
    pos = [Counter(w[i] for w in candidates) for i in range(5)]
    letter = Counter(ch for w in candidates for ch in set(w))
    def score(w: str) -> int:
        return sum(pos[i][w[i]] for i in range(5)) + sum(letter[ch] for ch in set(w))
    return sorted(candidates, key=score, reverse=True)[:limit]


def entropy(guess: str, candidates: list[str]) -> float:
    """Calculate feedback entropy without requiring cached pairs or growing a huge cache."""
    counts = Counter(feedback_code(guess, target) for target in candidates)
    n = len(candidates)
    return -sum((c/n) * math.log2(c/n) for c in counts.values() if c)


def prompt_from_history(history: list[tuple[str, str]]) -> str:
    if not history:
        return "wordle next guess: start"
    return "wordle next guess: " + " | ".join(f"{g}:{f}" for g, f in history)


class Strategy:
    def __init__(self, words: list[str], scorer: LLMScorer, top_pool: int = 80,
                 entropy_top: int = 15, llm_weight: float = 0.25):
        self.words = words
        self.scorer = scorer
        self.top_pool = top_pool
        self.entropy_top = entropy_top
        self.llm_weight = llm_weight
        self.cache: dict[tuple[tuple[str, str], ...], str] = {}

    def fb(self, g: str, t: str) -> int:
        # Feedback is cheap to calculate; avoid a global pair cache growing with simulations.
        return feedback_code(g, t)

    def next_guess(self, history: list[tuple[str, str]], candidates: list[str], attempt: int) -> str:
        if attempt == 1:
            return "salet" if "salet" in self.words else self.words[0]
        if len(candidates) == 1:
            return candidates[0]
        key = tuple(history)
        if key in self.cache:
            return self.cache[key]
        prompt = prompt_from_history(history)
        if not candidates:
            # Defensive recovery; should not occur with consistent feedback.
            if self.scorer.available:
                enc = self.scorer.tokenizer(prompt, return_tensors="pt").to(self.scorer.device)
                with torch.inference_mode():
                    pred = self.scorer.model.generate(**enc, max_new_tokens=8)
                word = self.scorer.tokenizer.decode(pred[0], skip_special_tokens=True).strip().lower()[:5]
                if valid_word(word):
                    return word
            return self.words[0]
        pool = positional_rank(candidates, self.top_pool)
        ent = [entropy(w, candidates) for w in pool]
        top_idx = np.argsort(ent)[::-1][:self.entropy_top]
        top_words = [pool[i] for i in top_idx]
        top_ent = [ent[i] for i in top_idx]
        llm_scores = self.scorer.score(prompt, top_words)
        combined = [(1-self.llm_weight)*e + self.llm_weight*l
                    for e, l in zip(norm(top_ent), norm(llm_scores))]
        chosen = top_words[int(np.argmax(combined))]
        self.cache[key] = chosen
        return chosen


def simulate_target(opening: str, target: str, vocab: list[str], strategy: Strategy,
                   max_guesses: int = MAX_GUESSES) -> int:
    candidates = list(vocab)
    history: list[tuple[str, str]] = []
    for turn in range(1, max_guesses + 1):
        guess = opening if turn == 1 else strategy.next_guess(history, candidates, turn)
        code = strategy.fb(guess, target)
        fb = decode_feedback(code)
        history.append((guess, fb))
        if guess == target:
            return turn
        candidates = [w for w in candidates if strategy.fb(guess, w) == code]
    return max_guesses + 1  # not solved in allotted guesses


def write_reports(output_dir: Path, results: list[dict], target_count: int, opening_count: int, display_top: int = 20):
    output_dir.mkdir(parents=True, exist_ok=True)
    sorted_results = sorted(results, key=lambda r: (r["mean_guesses"], r["failures"], r["opening_word"]))
    full_csv = output_dir / "best_guesser_all_openings.csv"
    fields = ["rank", "opening_word", "targets_tested", "solved_1", "solved_2", "solved_3",
              "solved_4", "solved_5", "solved_6", "failures", "mean_guesses",
              "median_guesses", "solve_rate", "guess_frequency_json"]
    with full_csv.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for rank, row in enumerate(sorted_results, 1):
            writer.writerow({"rank": rank, **{k: row[k] for k in fields if k not in ("rank", "guess_frequency_json")},
                            "guess_frequency_json": json.dumps(row["guess_frequency"], sort_keys=True)})
    top = sorted_results[:50]
    top_csv = output_dir / "best_guesser_top50.csv"
    with top_csv.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for rank, row in enumerate(top, 1):
            writer.writerow({"rank": rank, **{k: row[k] for k in fields if k not in ("rank", "guess_frequency_json")},
                            "guess_frequency_json": json.dumps(row["guess_frequency"], sort_keys=True)})
    groups: dict[int, list[dict]] = defaultdict(list)
    for row in sorted_results:
        groups[round(row["mean_guesses"] * 1000)].append(row)
    grouped_json = output_dir / "best_guesser_grouped_by_mean.json"
    with grouped_json.open("w", encoding="utf-8") as f:
        json.dump({str(k / 1000): [{"word": r["opening_word"], "frequency": r["guess_frequency"],
                                    "failures": r["failures"], "solve_rate": r["solve_rate"]}
                                   for r in group] for k, group in sorted(groups.items())},
                  f, indent=2)
    summary = {"targets_tested_per_opening": target_count, "opening_words_tested": opening_count,
               "top50": [{k: row[k] for k in ("opening_word", "mean_guesses", "median_guesses",
                                              "solve_rate", "failures", "guess_frequency")}
                         for row in top],
               "grouped_by_mean_guesses": {str(k/1000): [r["opening_word"] for r in g]
                                           for k, g in sorted(groups.items())}}
    with (output_dir / "best_guesser_summary.json").open("w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print(f"Reports saved to: {output_dir.resolve()}", flush=True)
    print(f"\nTOP {display_top} OPENING WORDS (mean guesses; ties broken by failures then alphabetically)")
    for i, r in enumerate(sorted_results[:display_top], 1):
        print(f"{i:2}. {r['opening_word']:5} mean={r['mean_guesses']:.4f} "
              f"median={r['median_guesses']:.1f} solve={r['solve_rate']:.2%} "
              f"freq={r['guess_frequency']}")
    print("\nGROUPED BY MEAN GUESSES (rounded to 0.001)")
    for key, rows in sorted(groups.items()):
        print(f"{key/1000:.3f}: " + ", ".join(r["opening_word"] for r in rows[:50]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", default=DEFAULT_CSV, help="Simulation CSV (optional vocabulary source)")
    parser.add_argument("--model-dir", default=DEFAULT_MODEL_DIR, help="Local FLAN-T5 folder; no downloads")
    parser.add_argument("--output-dir", default="best_guesser_results")
    parser.add_argument("--answers", help="Optional newline-delimited target list (defaults to full vocabulary)")
    parser.add_argument("--guesses", help="Optional newline-delimited opening-guess list (defaults to full vocabulary)")
    parser.add_argument("--max-guesses", type=int, default=6)
    parser.add_argument("--top-pool", type=int, default=80)
    parser.add_argument("--entropy-top", type=int, default=15)
    parser.add_argument("--llm-weight", type=float, default=0.25)
    parser.add_argument("--model-batch-size", type=int, default=32)
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument("--checkpoint-every", type=int, default=10)
    parser.add_argument("--resume", action="store_true", help="Continue completed opening words from checkpoint JSON")
    parser.add_argument("--limit-targets", type=int, help="Smoke-test subset; not exhaustive")
    parser.add_argument("--limit-openings", type=int, help="Smoke-test subset; not exhaustive")
    parser.add_argument("--top", type=int, default=20, help="Number of best opening results to print (default: 20)")
    parser.add_argument("--seed", type=int, default=2026)
    args = parser.parse_args()

    if args.max_guesses < 1:
        parser.error("--max-guesses must be positive")
    if args.top < 1:
        parser.error("--top must be positive")
    if args.limit_targets is not None and args.limit_targets < 1:
        parser.error("--limit-targets must be positive")
    if args.limit_openings is not None and args.limit_openings < 1:
        parser.error("--limit-openings must be positive")
    vocab = load_vocab(args.csv if Path(args.csv).exists() else None)
    if len(vocab) < 2:
        parser.error("Could not load word vocabulary. Install nltk and download its words corpus, or provide CSV.")
    if args.answers:
        answers = [w.strip().lower() for w in Path(args.answers).read_text(encoding="utf-8").splitlines()
                   if valid_word(w.strip())]
    else:
        answers = vocab.copy()
    if args.guesses:
        openings = [w.strip().lower() for w in Path(args.guesses).read_text(encoding="utf-8").splitlines()
                    if valid_word(w.strip())]
    else:
        openings = vocab.copy()
    answers = sorted(set(answers) & set(vocab))
    openings = sorted(set(openings) & set(vocab))
    # Randomly sample target words when a target limit is requested. The seed
    # makes the sample reproducible and shared across all opening-word tests.
    if args.limit_targets and args.limit_targets < len(answers):
        answers = random.Random(args.seed).sample(answers, args.limit_targets)
    # Randomly sample opening words when limited, or shuffle the full opening
    # list when no effective limit is applied. Use a separate RNG stream from
    # target sampling so both samples remain independently reproducible.
    opening_rng = random.Random(args.seed + 1)
    if args.limit_openings and args.limit_openings < len(openings):
        openings = opening_rng.sample(openings, args.limit_openings)
    else:
        opening_rng.shuffle(openings)
    scorer = LLMScorer(args.model_dir, args.model_batch_size, args.device)
    strategy = Strategy(vocab, scorer, args.top_pool, args.entropy_top, args.llm_weight)
    out_dir = Path(args.output_dir)
    checkpoint = out_dir / "checkpoint.json"
    completed: dict[str, dict] = {}
    checkpoint_meta = {
        "seed": args.seed,
        "targets_sha256": hashlib.sha256("\\n".join(answers).encode("utf-8")).hexdigest(),
        "openings_sha256": hashlib.sha256("\\n".join(openings).encode("utf-8")).hexdigest(),
        "max_guesses": args.max_guesses,
        "top_pool": args.top_pool,
        "entropy_top": args.entropy_top,
        "llm_weight": args.llm_weight,
        "model_dir": args.model_dir,
    }
    if args.resume and checkpoint.exists():
        try:
            saved = json.loads(checkpoint.read_text(encoding="utf-8"))
            if saved.get("_meta") == checkpoint_meta:
                completed = {k: v for k, v in saved.items() if k != "_meta"}
                print(f"Resume: loaded {len(completed)} opening-word checkpoints (same target sample).", flush=True)
            else:
                print("Checkpoint settings/target sample differ; starting a fresh tournament.", file=sys.stderr)
        except Exception as e:
            print(f"Checkpoint could not be read ({e}); starting fresh.", file=sys.stderr)
    start = time.time()
    total = len(openings)
    for oi, opening in enumerate(openings, 1):
        if opening in completed:
            continue
        freq = Counter()
        guesses_sum = 0
        solved_counts = Counter()
        for ti, target in enumerate(answers, 1):
            n = simulate_target(opening, target, vocab, strategy, args.max_guesses)
            freq[str(n)] += 1
            guesses_sum += n
            solved_counts[n] += 1
        mean = guesses_sum / len(answers)
        vals = []
        for n, c in solved_counts.items():
            vals.extend([n] * c)
        median = float(np.median(vals))
        failures = freq.get(str(args.max_guesses + 1), 0)
        completed[opening] = {"opening_word": opening, "targets_tested": len(answers),
                              "solved_1": solved_counts.get(1, 0), "solved_2": solved_counts.get(2, 0),
                              "solved_3": solved_counts.get(3, 0), "solved_4": solved_counts.get(4, 0),
                              "solved_5": solved_counts.get(5, 0), "solved_6": solved_counts.get(6, 0),
                              "failures": failures, "mean_guesses": mean, "median_guesses": median,
                              "solve_rate": 1 - failures / len(answers), "guess_frequency": dict(freq)}
        if oi % max(1, args.checkpoint_every) == 0 or oi == total:
            out_dir.mkdir(parents=True, exist_ok=True)
            checkpoint.write_text(json.dumps({"_meta": checkpoint_meta, **completed}, indent=2), encoding="utf-8")
        elapsed = time.time() - start
        print(f"[{oi}/{total}] opening={opening} mean={mean:.4f} solve={1-failures/len(answers):.2%} "
              f"elapsed={elapsed/60:.1f}m", flush=True)
    results = [row for key, row in completed.items() if key != "_meta"]
    write_reports(out_dir, results, len(answers), len(openings), display_top=args.top)
    print(f"Total wall time: {(time.time()-start)/60:.2f} minutes", flush=True)


if __name__ == "__main__":
    main()
