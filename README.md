# Wordle Guesser

A collection of Wordle-solving experiments, from a simple candidate-elimination script to a frequency-ranked manual assistant, an entropy-based Chrome/Edge browser extension, and a FLAN-T5-assisted guessing pipeline.

The repository explores how feedback constraints, letter statistics, information theory, simulation, and a small language model can be combined to choose better guesses.

## Features

- **Browser extension (recommended for playing):** analyzes the live Wordle board locally, filters possible answers, and ranks strategic guesses using feedback-pattern entropy.
- **Manual assistant:** enter each guess and its green/yellow/gray feedback to receive a filtered candidate list, letter frequencies, and weighted suggestions.
- **Algorithm experiments:** basic candidate filtering and a comparison of fixed opening-guess combinations.
- **Simulation dataset:** generate and store up to 8,000 simulated games.
- **FLAN-T5 experiment:** train a `google/flan-t5-small` model on simulated game histories and combine its candidate scores with entropy-based ranking.

## Repository structure

| File / directory | Purpose |
| --- | --- |
| `browser-extension/` | Manifest V3 extension for Chrome and Microsoft Edge. See its [README](browser-extension/README.md) for extension-specific details. |
| `algorithm.py` | Basic Wordle feedback, candidate filtering, and a six-guess random-candidate experiment with two fixed opening guesses. |
| `manual_player.py` | Interactive terminal assistant using a frequency-based vocabulary and weighted candidate ranking. |
| `best_suited_guesser.py` | Compares two three-word opening combinations across the same random target sample. |
| `data_generator.py` | Simulates games and writes the results to `wordle_8000_simulations.csv`. |
| `wordle_8000_simulations.csv` | Simulation data used by the language-model pipeline. |
| `llm.py` | Fine-tunes FLAN-T5-small on generated game histories and saves the model to `wordle_flan_t5/`. |
| `tester.py` | Loads the saved FLAN-T5 model and lets you test it against manually supplied target words. |
| `wordle_flan_t5/` | Tokenizer and model configuration assets; run `llm.py` to train/save the model weights required by `tester.py`. |

## How to use

Choose the workflow that matches what you want to do. For normal Wordle play, the browser extension is the easiest option and does not require Python or a model download.

### 1. Use the browser extension (Chrome / Edge)

1. Clone or download this repository.
2. Open the browser's extension management page:
   - Chrome: `chrome://extensions`
   - Microsoft Edge: `edge://extensions`
3. Turn on **Developer mode**.
4. Select **Load unpacked**.
5. Choose the repository's `browser-extension` folder (not the repository root).
6. Open or refresh a Wordle game. The extension adds its analysis interface to the game page.
7. Play normally and enter your feedback on the board; the extension analyzes the board and updates its candidate and guess rankings.

The extension performs its analysis locally in the browser. It does not submit guesses or send board data to a server. See [browser-extension/README.md](browser-extension/README.md) for ranking details, vocabulary notes, and troubleshooting.

### 2. Run the manual terminal assistant

This is the interactive helper for entering your own guesses and feedback.

Create and activate a virtual environment (optional, but recommended):

```bash
python -m venv .venv
```

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

macOS / Linux:

```bash
source .venv/bin/activate
```

Install its dependencies:

```bash
python -m pip install nltk wordfreq
```

Run:

```bash
python manual_player.py
```

For each turn:

1. Enter the five-letter word you played.
2. Enter exactly five feedback characters:
   - `G` = green (correct letter and position)
   - `Y` = yellow (letter is in the answer, but in another position)
   - `B` = gray/black (letter is not available in the answer, subject to Wordle's duplicate-letter rules)
3. Review the remaining candidate count, letter frequencies, and weighted shortlist.
4. Use a suggested word in Wordle, then repeat with its feedback.
5. Enter `exit` to stop.

Enter `GGGGG` when the guess solves the puzzle.

### 3. Run the basic algorithm

Install the required packages:

```bash
python -m pip install nltk numpy
```

Then run:

```bash
python algorithm.py
```

The script downloads the NLTK English words corpus if needed, selects a random five-letter target, and demonstrates candidate filtering. Its opening guesses are configured in `GUESS1` and `GUESS2`.

### 4. Compare opening-guess combinations

Install dependencies:

```bash
python -m pip install nltk numpy
```

Run:

```bash
python best_suited_guesser.py
```

This compares the configured `combo_a` and `combo_b` over the same 1,000 randomly sampled targets (with a fixed random seed). It reports remaining-candidate summaries after each opening guess and a head-to-head comparison after guess three.

### 5. Generate the simulation dataset

Install dependencies:

```bash
python -m pip install nltk numpy
```

Run:

```bash
python data_generator.py
```

The script writes `wordle_8000_simulations.csv` in the current working directory and prints the observed win rate. The number of simulations and opening guesses can be changed near the top of the script.

### 6. Train and test the FLAN-T5 model (advanced)

This workflow requires PyTorch and Hugging Face Transformers. Install the packages:

```bash
python -m pip install nltk numpy pandas torch transformers
```

First make sure `wordle_8000_simulations.csv` exists. Generate it with the previous step if necessary. Then train the model:

```bash
python llm.py
```

The script fine-tunes `google/flan-t5-small` for the configured number of epochs and saves the resulting model and tokenizer to `wordle_flan_t5/`. The first run may download the base model from Hugging Face; training time depends on your hardware. CUDA is used automatically when PyTorch detects a compatible GPU; otherwise, training runs on CPU.

After training has completed, launch the interactive tester:

```bash
python tester.py
```

Enter a five-letter target word to simulate a game, or enter `quit` to exit. The tester expects the model weights produced by `llm.py`; the configuration and tokenizer files in the repository alone are not a substitute for those trained weights.

## Feedback notation

| Letter | Wordle tile | Meaning |
| --- | --- | --- |
| `G` | Green | Correct letter in the correct position |
| `Y` | Yellow | Letter occurs in the answer, but not at this position |
| `B` | Gray / Black | Letter is not present in the answer |

**Important:** repeated letters require careful feedback handling. The browser extension and `manual_player.py` use two-pass feedback logic to account for duplicate letters. The earlier demonstration scripts (`algorithm.py` and `data_generator.py`) use a simplified membership-based feedback rule, so their results are experimental rather than an exact implementation of every Wordle duplicate-letter case.

## How the browser extension ranks guesses

The extension first filters the answer candidates using the complete feedback pattern. It then simulates possible feedback outcomes for candidate guesses and ranks guesses by Shannon entropy: guesses that divide the remaining answer set into more informative groups tend to rank higher. A preliminary letter/position score limits the number of guesses that need full entropy evaluation.

The displayed candidate-list percentage assumes all remaining dictionary entries are equally likely. It is not a calibrated probability of the official daily answer.

## Notes and limitations

- The vocabulary is broad and is not an official New York Times Wordle answer list. A word accepted as a guess may not be eligible as an answer.
- The simulation results depend on the vocabulary, random sampling, and strategy implemented in the scripts; they should not be interpreted as a guaranteed real-game win rate.
- The FLAN-T5 component is an experiment, not a guarantee that the model's suggestion is better than the entropy-ranked alternatives.
- The browser extension is independent of the Python and FLAN-T5 workflows.

## License

This project is distributed under the license in [LICENSE](LICENSE).
