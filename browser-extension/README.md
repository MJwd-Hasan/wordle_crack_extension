# Wordle Guesser browser extension

A Manifest V3 extension for Chrome and Microsoft Edge. Version 2 upgrades the original `manual_player.py` port with a larger vocabulary, exact feedback-pattern scoring, and a redesigned analysis panel.

## What's new in v2

- **10,798 answer candidates**: five-letter entries from the 50,000-word Google Ngrams frequency list, combined with all target words in this repository's 8,000-game simulation dataset.
- **11,730 allowed guesses**: the answer candidates plus five-letter words found in the simulation guess history and the frequency list.
- **Entropy-based strategy**: ranks strategic guesses by the Shannon information in their possible green/yellow/gray feedback patterns (up to 243 outcomes).
- Shows expected remaining candidates and the largest possible remaining group, not just a letter-frequency score.
- Separates strategic probe guesses from possible answers.
- Displays letter frequencies, eliminated letters, and an explicitly qualified equal-list candidate chance.
- Duplicate-letter feedback remains handled with Wordle's two-pass rules.
- Keeps all processing local; it never submits guesses or sends board data to a server.

## Install in Chrome / Edge

1. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
2. Enable **Developer mode**.
3. Click **Load unpacked** or reload the existing unpacked extension.
4. Select this `browser-extension` directory.
5. Refresh the Wordle page.

## How the ranking works

For each turn, the extension filters the answer dictionary against every submitted row using exact Wordle feedback. It then evaluates a shortlist of possible answer guesses and non-answer probe guesses by simulating their feedback against every remaining answer. The ranked score is the entropy of the resulting feedback groups; the panel also reports expected candidates remaining and the worst-case group size.

A lightweight letter/position score is used only to choose a computationally manageable shortlist before exact entropy scoring. It is not the final ranking formula.

The displayed “% of list” is (100 / N), assuming all (N) remaining entries in this broad answer dictionary are equally likely. It is **not** a calibrated probability of the official NYT answer.

## Vocabulary sources and attribution

- Google Ngrams-derived frequency list: [david47k/top-english-wordlists](https://github.com/david47k/top-english-wordlists), file `top_english_words_lower_50000.txt`. The upstream repository states the compilation is licensed under **Creative Commons Attribution 3.0 Unported** and attributes the data to Google Books Ngrams (English dataset, 1950–2012).
- Additional target and guess words: this repository's `wordle_8000_simulations.csv`.

The broad vocabulary improves coverage but is not an official NYT/Wordle Archive answer list. It may contain entries a particular game does not accept as an answer, and a game's answer list may still contain words not represented here.

## Files

- `manifest.json` — site/frame permissions and content-script loading.
- `words.js` — bundled answer and allowed-guess vocabularies.
- `engine.js` — feedback filtering, letter statistics, and entropy ranking.
- `content.js` — board detection and analysis UI.
- `popup.html`, `popup.css` — extension popup.

No remote requests, analytics, or automatic guess submission.
