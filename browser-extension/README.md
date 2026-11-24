# Wordle Guesser browser extension

A Manifest V3 extension for Chrome and Microsoft Edge. It ports the scoring and filtering logic from the repository's `manual_player.py`.

## Features
- Watches Wordle Archive and NYT Wordle pages for completed guess rows.
- Reads visible tile feedback (green/yellow/gray) and the guessed word.
- Filters candidates using Wordle's duplicate-letter rules.
- Shows up to 25 weighted suggestions, letter probabilities, and eliminated letters.
- Uses the original scoring formula: 60% positional probability + 40% unique-letter probability.
- Runs locally; no remote requests, analytics, or automatic guess submission.

## Install in Chrome
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this `browser-extension` directory.

## Install in Edge
1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this `browser-extension` directory.

## Candidate vocabulary
`words.js` contains the distinct five-letter target words in the repository's `wordle_8000_simulations.csv` dataset (rather than the full 50,000-word wordfreq list used by the Python script). This keeps the extension self-contained and lightweight, but means some valid guesses/answers may not be represented. Add a broader five-letter vocabulary to `words.js` to expand coverage.

## Compatibility note
Wordle's page markup can change. The content script supports the common custom-element tile markup and a DOM fallback; if a site changes its tile attributes or shadow-DOM structure, its detector may need updating. The extension only analyzes completed rows and does not interact with the game's keyboard or submit guesses.
