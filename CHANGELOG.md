# Changelog

All notable releases of Wordle Guesser are documented here.

## [2.0.1] - 2026-11-25

- Removed best-strategic-guess and probe-word recommendations from the browser extension.
- Filtered possible answers against the complete submitted guess history using exact duplicate-letter feedback.
- Prevented multiple board-detection fallbacks from interpreting the same row and adding conflicting constraints.
- Added regression checks for repeated-letter feedback and multi-row candidate filtering; updated extension documentation.

This project follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

## [2.0.0] - Initial version baseline

- Establishes the existing browser-extension version as the project's starting release.
- Includes the Manifest V3 browser extension with local board analysis and entropy-ranked suggestions.
- Includes the accompanying Python assistant, algorithm experiments, simulation pipeline, and FLAN-T5 experiment.

