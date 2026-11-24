# Wordle Crack Extension

A collection of Wordle-solving experiments, from a simple candidate-elimination script to a frequency-ranked manual assistant, an entropy-based Chrome/Edge browser extension, and a FLAN-T5-assisted guessing pipeline.

The repository explores how feedback constraints, letter statistics, information theory, simulation, and a small language model can be combined to choose better guesses.

## Features

- **Browser extension (recommended):** analyzes the live Wordle board locally, filters possible answers, and ranks strategic guesses using feedback-pattern entropy.
- **Manual assistant:** enter each guess and its green/yellow/gray feedback to receive a filtered candidate list, letter frequencies, and weighted suggestions.
- **Algorithm experiments:** basic candidate filtering and a comparison of fixed opening-guess combinations.
- **Simulation dataset:** generate and store up to 8,000 simulated games.
- **FLAN-T5 experiment:** train a `google/flan-t5-small` model on simulated game histories and combine its candidate scores with entropy-based ranking.

## How to use

**Start with the browser extension** if your goal is to get suggestions while playing Wordle. The remaining sections document the optional Python-based experiments and tools.

## 1. Browser extension quick start (Chrome / Microsoft Edge)

The browser extension is the recommended way to use this project during an actual Wordle game. It does not require Python, a terminal, or a model download.

### Install the extension

1. **Download the repository:** clone it with Git or download the ZIP and extract it.
2. **Open your browser's extensions page:**
   - Google Chrome: `chrome://extensions`
   - Microsoft Edge: `edge://extensions`
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. In the folder picker, select the repository's **`browser-extension` folder**. Do not select the repository root.
6. Once the extension appears in the extensions list, open or refresh your Wordle game page.

### Use it while playing

1. Start a Wordle game and enter your first five-letter guess as usual.
2. Submit the guess in Wordle so the board reveals its green, yellow, and gray tiles.
3. The extension reads the board feedback and updates its analysis panel.
4. Review the remaining possible answers and the ranked strategic guesses. The panel distinguishes possible answers from probe guesses that may be useful for gathering information.
5. Choose a suggested word, enter it in Wordle, and submit it.
6. Repeat the process after each row is evaluated. The candidate list and rankings update as more feedback becomes available.

### What the extension shows

- Remaining answer candidates after applying all visible feedback.
- Strategic guesses ranked using the information (Shannon entropy) their possible feedback patterns provide.
- Expected number of candidates remaining and the largest possible remaining group.
- Letter frequencies and eliminated-letter information.
- A candidate-list percentage based on the simplifying assumption that all remaining dictionary entries are equally likely. This is **not** a calibrated probability of the official daily answer.

### Privacy and troubleshooting

- All board analysis runs locally in your browser. The extension does not submit guesses or send board data to a server.
- If the panel does not appear after installation, confirm that you selected the `browser-extension` directory, ensure the extension is enabled, and refresh the Wordle tab.
- If you update the extension's files, return to the extensions page and click the extension's **Reload** control, then refresh the Wordle tab.
- For implementation details, vocabulary sources, and ranking methodology, see the [browser extension guide](browser-extension/README.md).

## 2. Other user manuals: Python tools

The following tools are optional. They are independent of the browser extension and are intended for terminal-based experiments, simulations, and model training.

### 2.1 Run the manual terminal assistant

This is an interactive helper for entering your own guesses and feedback.

Create and activate a virtual environment (optional, but recommended):

```bash
python -m venv .venv
```

Windows PowerShell:

```powershell
.venv\\Scripts\\Activate.ps1
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

### 2.2 Run the basic algorithm

Install the required packages:

```bash
python -m pip install nltk numpy
```

Then run:

```bash
python algorithm.py
```

The script downloads the NLTK English words corpus if needed, selects a random five-letter target, and demonstrates candidate filtering. Its opening guesses are configured in `GUESS1` and `GUESS2`.

### 2.3 Compare opening-guess combinations

Install dependencies:

```bash
python -m pip install nltk numpy
```

Run:

```bash
python best_suited_guesser.py
```

This compares the configured `combo_a` and `combo_b` over the same 1,000 randomly sampled targets (with a fixed random seed). It reports remaining-candidate summaries after each opening guess and a head-to-head comparison after guess three.

### 2.4 Generate the simulation dataset

Install dependencies:

```bash
python -m pip install nltk numpy
```

Run:

```bash
python data_generator.py
```

The script writes `wordle_8000_simulations.csv` in the current working directory and prints the observed win rate. The number of simulations and opening guesses can be changed near the top of the script.

### 2.5 Train and test the FLAN-T5 model (advanced)

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
