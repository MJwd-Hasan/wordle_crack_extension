/* Wordle Guesser v2: exact feedback filtering + entropy-ranked strategic guesses. */
(() => {
  "use strict";
  const ANSWERS = (window.WORDLE_GUESSER_WORDS || []).filter(w => /^[a-z]{5}$/.test(w));
  const GUESSES = (window.WORDLE_GUESSER_GUESSES || ANSWERS).filter(w => /^[a-z]{5}$/.test(w));
  const COMMON = window.WORDLE_GUESSER_COMMON || [];
  const COMMON_RANK = Object.create(null);
  COMMON.forEach((word, index) => { COMMON_RANK[word] = index; });
  const ANSWER_SET = new Set(ANSWERS);
  const MAX_ANSWER_GUESSES = 600;
  const MAX_PROBE_GUESSES = 300;

  function getFeedback(guess, answer) {
    guess = String(guess || "").toLowerCase();
    answer = String(answer || "").toLowerCase();
    if (!/^[a-z]{5}$/.test(guess) || !/^[a-z]{5}$/.test(answer)) return "";
    const result = ["B", "B", "B", "B", "B"];
    const remaining = new Int8Array(26);
    for (let i = 0; i < 5; i++) remaining[answer.charCodeAt(i) - 97]++;
    for (let i = 0; i < 5; i++) {
      if (guess[i] === answer[i]) {
        result[i] = "G";
        remaining[guess.charCodeAt(i) - 97]--;
      }
    }
    for (let i = 0; i < 5; i++) {
      const code = guess.charCodeAt(i) - 97;
      if (result[i] === "B" && remaining[code] > 0) {
        result[i] = "Y";
        remaining[code]--;
      }
    }
    return result.join("");
  }

  function filterWords(guess, feedback, pool) {
    const pattern = String(feedback || "").toUpperCase();
    if (!/^[a-z]{5}$/.test(guess) || !/^[GYB]{5}$/.test(pattern)) return [];
    return pool.filter(word => getFeedback(guess, word) === pattern);
  }

  function feedbackCode(guessChars, answerChars, scratch) {
    scratch.fill(0);
    for (let i = 0; i < 5; i++) scratch[answerChars[i]]++;
    let code = 0, multiplier = 1, greenMask = 0;
    for (let i = 0; i < 5; i++) {
      if (guessChars[i] === answerChars[i]) {
        greenMask |= (1 << i);
        code += 2 * multiplier;
        scratch[guessChars[i]]--;
      }
      multiplier *= 3;
    }
    multiplier = 1;
    for (let i = 0; i < 5; i++) {
      if (!(greenMask & (1 << i)) && scratch[guessChars[i]] > 0) {
        code += multiplier;
        scratch[guessChars[i]]--;
      }
      multiplier *= 3;
    }
    return code;
  }

  function buildLetterStats(pool) {
    const n = pool.length;
    const overall = new Float64Array(26);
    const positions = Array.from({ length: 5 }, () => new Float64Array(26));
    if (!n) return { overall, positions };
    for (const word of pool) {
      const seen = new Uint8Array(26);
      for (let i = 0; i < 5; i++) {
        const c = word.charCodeAt(i) - 97;
        positions[i][c]++;
        if (!seen[c]) { overall[c]++; seen[c] = 1; }
      }
    }
    for (let c = 0; c < 26; c++) overall[c] /= n;
    for (let i = 0; i < 5; i++) for (let c = 0; c < 26; c++) positions[i][c] /= n;
    return { overall, positions };
  }

  function heuristic(word, stats, isAnswer) {
    let coverage = 0, positional = 0, mask = 0, unique = 0;
    for (let i = 0; i < 5; i++) {
      const c = word.charCodeAt(i) - 97;
      positional += stats.positions[i][c];
      const bit = 1 << c;
      if (!(mask & bit)) { mask |= bit; coverage += stats.overall[c]; unique++; }
    }
    // Shortlist only: final ordering uses exact Wordle feedback entropy.
    return 0.55 * coverage / 5 + 0.45 * positional / 5 -
      (5 - unique) * 0.012 + (isAnswer ? 0.006 : 0);
  }

  function scoreGuess(guess, poolSize, candidateCodes) {
    const counts = new Uint16Array(243);
    const scratch = new Int8Array(26);
    const guessChars = new Uint8Array(5);
    for (let i = 0; i < 5; i++) guessChars[i] = guess.charCodeAt(i) - 97;
    let worstCase = 0, sumSquares = 0;
    for (let i = 0; i < candidateCodes.length; i++) {
      const pattern = feedbackCode(guessChars, candidateCodes[i], scratch);
      const count = ++counts[pattern];
      if (count > worstCase) worstCase = count;
    }
    let entropy = 0;
    for (let i = 0; i < counts.length; i++) {
      const count = counts[i];
      if (!count) continue;
      const p = count / poolSize;
      entropy -= p * Math.log2(p);
      sumSquares += count * count;
    }
    const isAnswer = ANSWER_SET.has(guess);
    return {
      word: guess,
      informationGain: entropy,
      expectedRemaining: sumSquares / poolSize,
      worstCase,
      isAnswer,
      solveChance: isAnswer ? 100 / poolSize : 0
    };
  }

  function getBlackLetters(history) {
    const seen = new Set(), positive = new Set();
    for (const row of history) {
      for (let i = 0; i < 5; i++) {
        const ch = row.guess[i];
        seen.add(ch);
        if (row.feedback[i] === "G" || row.feedback[i] === "Y") positive.add(ch);
      }
    }
    return [...seen].filter(ch => !positive.has(ch)).sort();
  }

  function analyze(history) {
    const cleanHistory = (history || []).filter(row =>
      row && /^[a-z]{5}$/.test(String(row.guess || "").toLowerCase()) &&
      /^[GYB]{5}$/.test(String(row.feedback || "").toUpperCase())
    ).map(row => ({
      guess: String(row.guess).toLowerCase(),
      feedback: String(row.feedback).toUpperCase()
    }));

    let candidates = ANSWERS.slice();
    for (const row of cleanHistory) {
      candidates = filterWords(row.guess, row.feedback, candidates);
      if (!candidates.length) break;
    }

    const stats = buildLetterStats(candidates);
    const n = candidates.length;
    const blackLetters = getBlackLetters(cleanHistory);
    const letters = [];
    for (let c = 0; c < 26; c++) {
      if (stats.overall[c] > 0) letters.push({
        letter: String.fromCharCode(97 + c),
        probability: stats.overall[c] * 100
      });
    }
    letters.sort((a, b) => b.probability - a.probability || a.letter.localeCompare(b.letter));

    if (!n) return {
      remaining: 0, blackLetters, letters: [], words: [], possibleAnswers: [],
      vocabularySize: ANSWERS.length, guessVocabularySize: GUESSES.length,
      scoredGuessCount: 0, solved: false, noMatches: true
    };

    const candidateCodes = candidates.map(word => {
      const codes = new Uint8Array(5);
      for (let i = 0; i < 5; i++) codes[i] = word.charCodeAt(i) - 97;
      return codes;
    });

    const answerLimit = candidates.length <= 1800 ? candidates.length : MAX_ANSWER_GUESSES;
    const answerShortlist = candidates.map(word => ({
      word, rank: heuristic(word, stats, true)
    })).sort((a, b) => b.rank - a.rank || a.word.localeCompare(b.word))
      .slice(0, answerLimit);

    const candidateSet = new Set(candidates);
    const probeShortlist = GUESSES.filter(word => !candidateSet.has(word))
      .map(word => ({ word, rank: heuristic(word, stats, false) }))
      .sort((a, b) => b.rank - a.rank || a.word.localeCompare(b.word))
      .slice(0, MAX_PROBE_GUESSES);

    const guesses = [...answerShortlist, ...probeShortlist];
    const scored = guesses.map(item => scoreGuess(item.word, n, candidateCodes));
    scored.sort((a, b) =>
      b.informationGain - a.informationGain ||
      a.expectedRemaining - b.expectedRemaining ||
      Number(b.isAnswer) - Number(a.isAnswer) ||
      a.word.localeCompare(b.word)
    );

    const commonRank = word => Object.prototype.hasOwnProperty.call(COMMON_RANK, word)
      ? COMMON_RANK[word] : Number.MAX_SAFE_INTEGER;
    const possibleAnswers = candidates.slice().sort((a, b) =>
      commonRank(a) - commonRank(b) || a.localeCompare(b)
    ).slice(0, 20).map(word => ({
      word, chance: 100 / n, commonWord: commonRank(word) !== Number.MAX_SAFE_INTEGER
    }));

    return {
      remaining: n,
      blackLetters,
      letters: letters.slice(0, 15),
      words: scored.slice(0, 10),
      possibleAnswers,
      vocabularySize: ANSWERS.length,
      guessVocabularySize: GUESSES.length,
      scoredGuessCount: scored.length,
      solved: cleanHistory.some(row => row.feedback === "GGGGG"),
      noMatches: false
    };
  }

  function selfTest() {
    const tests = [
      ["allee", "apple", "GYBBG"],
      ["sassy", "class", "YYBGB"],
      ["eerie", "refer", "YGYBB"]
    ];
    function decodePattern(code) {
      let out = "";
      for (let i = 0; i < 5; i++) {
        const digit = code % 3;
        out += digit === 2 ? "G" : digit === 1 ? "Y" : "B";
        code = Math.floor(code / 3);
      }
      return out;
    }
    return tests.map(([guess, answer, expected]) => {
      const guessChars = Uint8Array.from([...guess].map(ch => ch.charCodeAt(0) - 97));
      const answerChars = Uint8Array.from([...answer].map(ch => ch.charCodeAt(0) - 97));
      const fastFeedback = decodePattern(feedbackCode(guessChars, answerChars, new Int8Array(26)));
      const actual = getFeedback(guess, answer);
      return {
        guess, answer, expected, actual, fastFeedback,
        pass: actual === expected && fastFeedback === expected
      };
    });
  }

  window.WordleGuesserEngine = { analyze, getFeedback, filterWords, selfTest };
})();