# Wordle Guesser browser extension

A Manifest V3 extension for Chrome and Microsoft Edge. Version **2.0.1** focuses on filtering possible answers from the complete submitted board history.

## Features

- A bundled five-letter answer vocabulary sourced from the repository's existing vocabulary files.
- Exact green, yellow, and gray feedback matching, including repeated-letter rules.
- Candidate checks against **every submitted row**; every displayed answer must satisfy the complete detected feedback history.
- A list of up to 50 matching possible answers, letter frequencies, eliminated letters, and a diagnostic summary of the detected board.
- Local-only processing. The extension never submits guesses or sends board data to a server.

The extension no longer displays best-strategic-guess or probe-word recommendations.

## Install in Chrome / Edge

1. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
2. Enable **Developer mode**.
3. Click **Load unpacked** or reload the existing unpacked extension.
4. Select this `browser-extension` directory.
5. Refresh the Wordle page.

## How answer filtering works

For each bundled answer, the engine recomputes Wordle's exact feedback for every submitted guess and retains the word only when it matches every row. Greens are allocated first; yellows are then allocated from the remaining copies of each letter. This correctly handles guesses containing repeated letters.

The content script uses the native board-row parser when it recognizes NYT Wordle or Wordle Archive rows. It does not combine native and generic fallback parsers for the same board, avoiding duplicate or conflicting interpretations of a row. Generic parsing is used only when no supported native row container is detected.

If no bundled dictionary word matches, the panel displays the detected guesses and board diagnostics. This can indicate a board-reading issue or that the game's answer is absent from the broad local dictionary; it does not change the Wordle board.

The displayed “% of list” assumes all remaining dictionary entries are equally likely. It is **not** a calibrated probability of the official NYT answer. The vocabulary is not an official NYT or Wordle Archive answer list, so some game-specific answers may be missing and some listed words may not be accepted by a particular game.

## Vocabulary sources and attribution

- Google Ngrams-derived frequency list: [david47k/top-english-wordlists](https://github.com/david47k/top-english-wordlists), file `top_english_words_lower_50000.txt`. The upstream repository states the compilation is licensed under **Creative Commons Attribution 3.0 Unported** and attributes the data to Google Books Ngrams (English dataset, 1950–2012).
- Additional target words: this repository's `wordle_8000_simulations.csv`.

## Files

- `manifest.json` — site/frame permissions and extension version.
- `words.js` — bundled answer vocabulary and frequency ordering.
- `engine.js` — exact feedback generation, full-history candidate filtering, and letter statistics.
- `content.js` — board detection, diagnostics, and possible-answer UI.
- `popup.html`, `popup.css` — extension popup.

No remote requests, analytics, or automatic guess submission.
