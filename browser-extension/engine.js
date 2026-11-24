/* Wordle Guesser v2: exact feedback filtering + entropy-ranked strategic guesses. */
(() => {
  "use strict";
  const ANSWERS = (window.WORDLE_GUESSER_WORDS || []).filter(w => /^[a-z]{5}$/.test(w));
  const COMMON = window.WORDLE_GUESSER_COMMON || [];
  const COMMON_RANK = Object.create(null);
  COMMON.forEach((word, index) => { COMMON_RANK[word] = index; });

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

  function matchesHistory(word, history) {
    return history.every(row => getFeedback(row.guess, word) === row.feedback);
  }

  function analyze(history) {
    const cleanHistory = (history || []).filter(row =>
      row && /^[a-z]{5}$/i.test(String(row.guess || "")) &&
      /^[GYB]{5}$/i.test(String(row.feedback || ""))
    ).map(row => ({
      guess: String(row.guess).toLowerCase(),
      feedback: String(row.feedback).toUpperCase()
    }));

    // Keep a word only when its recomputed feedback matches every submitted row.
    const candidates = ANSWERS.filter(word => matchesHistory(word, cleanHistory));
    const n = candidates.length;
    const blackLetters = getBlackLetters(cleanHistory);

    if (!n) return {
      remaining: 0, blackLetters, letters: [], possibleAnswers: [],
      vocabularySize: ANSWERS.length, shownAnswerCount: 0,
      solved: cleanHistory.some(row => row.feedback === "GGGGG"),
      noMatches: true
    };

    const stats = buildLetterStats(candidates);
    const letters = [];
    for (let c = 0; c < 26; c++) {
      if (stats.overall[c] > 0) letters.push({
        letter: String.fromCharCode(97 + c),
        probability: stats.overall[c] * 100
      });
    }
    letters.sort((x, y) =>
      y.probability - x.probability || x.letter.localeCompare(y.letter)
    );

    const commonRank = word => Object.prototype.hasOwnProperty.call(COMMON_RANK, word)
      ? COMMON_RANK[word] : Number.MAX_SAFE_INTEGER;
    const sortedCandidates = candidates.slice().sort((x, y) =>
      commonRank(x) - commonRank(y) || x.localeCompare(y)
    );
    const possibleAnswers = sortedCandidates.slice(0, 50).map(word => ({
      word, chance: 100 / n,
      commonWord: commonRank(word) !== Number.MAX_SAFE_INTEGER
    }));

    return {
      remaining: n, blackLetters, letters: letters.slice(0, 15),
      possibleAnswers, vocabularySize: ANSWERS.length,
      shownAnswerCount: possibleAnswers.length,
      solved: cleanHistory.some(row => row.feedback === "GGGGG"),
      noMatches: false
    };
  }

  function selfTest() {
    const examples = [
      { guess: "allee", answer: "apple", expected: "GYBBG" },
      { guess: "sassy", answer: "class", expected: "YYBGB" },
      { guess: "eerie", answer: "refer", expected: "YGYBB" }
    ];
    const feedbackTests = examples.map(test => {
      const actual = getFeedback(test.guess, test.answer);
      return { ...test, actual, pass: actual === test.expected };
    });
    const pool = [...new Set([
      ...examples.map(test => test.answer),
      "apply", "ample", "glass", "racer"
    ])];
    const filteringTests = examples.map(test => {
      const filtered = filterWords(test.guess, test.expected, pool);
      const allResultsMatch = filtered.every(word =>
        getFeedback(test.guess, word) === test.expected
      );
      return {
        guess: test.guess, answer: test.answer,
        answerRetained: filtered.includes(test.answer),
        allResultsMatch,
        pass: filtered.includes(test.answer) && allResultsMatch
      };
    });
    const history = [
      { guess: "allee", feedback: "GYBBG" },
      { guess: "crane", feedback: getFeedback("crane", "apple") }
    ];
    const multiRow = pool.filter(word => matchesHistory(word, history));
    const multiRowPass = multiRow.includes("apple") &&
      multiRow.every(word => matchesHistory(word, history));
    return {
      feedbackTests, filteringTests,
      multiRowTest: {
        answerRetained: multiRow.includes("apple"),
        allResultsMatch: multiRow.every(word => matchesHistory(word, history)),
        pass: multiRowPass
      },
      pass: feedbackTests.every(test => test.pass) &&
        filteringTests.every(test => test.pass) && multiRowPass
    };
  }

  window.WordleGuesserEngine = { analyze, getFeedback, filterWords, matchesHistory, selfTest };
})();