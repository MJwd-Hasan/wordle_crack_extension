(() => {
  "use strict";
  let lastSignature = "", panel, root;

  // Walk regular DOM and every open Shadow DOM tree (including nested roots).
  function allElements(start = document) {
    const out = [], seen = new Set(), stack = [start];
    while (stack.length) {
      const node = stack.pop();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      if (!node.querySelectorAll) continue;
      for (const el of node.querySelectorAll("*")) {
        out.push(el);
        if (el.shadowRoot) stack.push(el.shadowRoot);
      }
    }
    return out;
  }

  function normalizeFeedback(value) {
    const map = {
      correct: "G", green: "G", good: "G", g: "G",
      present: "Y", yellow: "Y", close: "Y", y: "Y",
      absent: "B", gray: "B", grey: "B", wrong: "B", black: "B", b: "B"
    };
    const key = String(value ?? "").trim().toLowerCase();
    return map[key] || (["G", "Y", "B"].includes(key.toUpperCase()) ? key.toUpperCase() : "");
  }

  function parseArrayLike(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string" || !value.trim()) return null;
    const s = value.trim();
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
    if (s.length === 5 && /^[a-zA-Z]+$/.test(s)) return s.split("");
    return null;
  }

  function rowDataFromInternals(row) {
    // NYT Wordle exposes these on each game-row custom element.
    // They are properties (not necessarily HTML attributes).
    let letters = row._letters ?? row.letters ?? row.getAttribute?.("_letters");
    let evaluation = row._evaluation ?? row.evaluation ?? row.getAttribute?.("_evaluation");
    letters = parseArrayLike(letters);
    evaluation = parseArrayLike(evaluation);
    if (!letters || !evaluation || letters.length !== 5 || evaluation.length !== 5) return null;
    const guess = letters.map(x => String(x ?? "").trim().toLowerCase()).join("");
    const feedback = evaluation.map(normalizeFeedback).join("");
    if (!/^[a-z]{5}$/.test(guess) || !/^[GYB]{5}$/.test(feedback)) return null;
    return { guess, feedback };
  }

  function readTile(tile) {
    let state = "";
    for (const attr of ["evaluation", "data-state", "data-status", "status", "aria-label"]) {
      state = tile.getAttribute?.(attr) || "";
      if (state) break;
    }
    let feedback = normalizeFeedback(state);
    if (!feedback && tile.classList) {
      for (const cls of tile.classList) {
        feedback = normalizeFeedback(cls);
        if (feedback) break;
      }
    }
    const letter = (
      tile.getAttribute?.("letter") ||
      tile.getAttribute?.("data-letter") ||
      tile.textContent ||
      ""
    ).trim().toLowerCase();
    return { letter, feedback };
  }

  function getHistory() {
    const elements = allElements();
    const rows = elements.filter(el => /^(GAME-ROW|WORDLE-ROW)$/.test(el.tagName || ""));
    const history = [];
    const seen = new Set();

    for (const row of rows) {
      const internal = rowDataFromInternals(row);
      if (internal) {
        const key = internal.guess + ":" + internal.feedback;
        if (!seen.has(key)) { history.push(internal); seen.add(key); }
        continue;
      }

      const scope = row.shadowRoot || row;
      const tiles = Array.from(scope.querySelectorAll?.(
        "game-tile, wordle-tile, [data-state], [data-status], [evaluation], .tile, .letter"
      ) || []).map(readTile).filter(t => /^[a-z]$/.test(t.letter));
      if (tiles.length >= 5) {
        const guess = tiles.slice(0, 5).map(t => t.letter).join("");
        const feedback = tiles.slice(0, 5).map(t => t.feedback).join("");
        if (/^[a-z]{5}$/.test(guess) && /^[GYB]{5}$/.test(feedback)) {
          const key = guess + ":" + feedback;
          if (!seen.has(key)) { history.push({ guess, feedback }); seen.add(key); }
        }
      }
    }

    // Fallback for archive clones that use ordinary HTML tiles rather than
    // game-row/game-tile web components.
    if (!history.length) {
      const tiles = elements.filter(el => el.matches?.(
        "[data-state][data-letter], [data-status][data-letter], .tile, [role='gridcell']"
      ));
      const groups = new Map();
      for (const tile of tiles) {
        const parent = tile.parentElement;
        if (!parent) continue;
        if (!groups.has(parent)) groups.set(parent, []);
        groups.get(parent).push(readTile(tile));
      }
      for (const group of groups.values()) {
        const valid = group.filter(t => /^[a-z]$/.test(t.letter) && t.feedback);
        if (valid.length < 5) continue;
        const guess = valid.slice(0, 5).map(t => t.letter).join("");
        const feedback = valid.slice(0, 5).map(t => t.feedback).join("");
        if (/^[a-z]{5}$/.test(guess) && /^[GYB]{5}$/.test(feedback)) {
          const key = guess + ":" + feedback;
          if (!seen.has(key)) { history.push({ guess, feedback }); seen.add(key); }
        }
      }
    }
    return history;
  }

  function ensurePanel() {
    if (panel?.isConnected) return;
    panel = document.createElement("div");
    panel.id = "wordle-guesser-overlay";
    Object.assign(panel.style, {
      position: "fixed", right: "16px", bottom: "16px",
      zIndex: "2147483647", width: "min(360px,calc(100vw - 32px))"
    });
    root = panel.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      *{box-sizing:border-box}.card{font:13px/1.45 system-ui,sans-serif;color:#202124;background:#fff;border:1px solid #d9dce1;border-radius:14px;box-shadow:0 8px 32px #0003;overflow:hidden}
      header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#202124;color:white;font-weight:700}
      button{border:0;background:transparent;color:inherit;font-size:18px;cursor:pointer}.body{padding:12px 14px;max-height:55vh;overflow:auto}
      .muted{color:#687078}.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.chip{background:#f0f2f4;border-radius:6px;padding:4px 7px;font-variant-numeric:tabular-nums}
      .word{display:flex;justify-content:space-between;padding:6px 8px;border-bottom:1px solid #eee}.word:first-child{font-weight:700;background:#f4f7f4}
      .section{margin-top:12px;font-weight:700}.green{color:#16834a}.red{color:#b42318}
    </style><div class="card"><header><span>Wordle Guesser</span><button id="close" aria-label="Close">×</button></header><div class="body" id="body"><span class="muted">Waiting for a completed guess…</span></div></div>`;
    root.getElementById("close").addEventListener("click", () => panel.remove());
    document.documentElement.appendChild(panel);
  }

  function render(history, data) {
    ensurePanel();
    const body = root.getElementById("body");
    if (!history.length) {
      body.innerHTML = '<span class="muted">Play a guess to see live analysis.</span>';
      return;
    }
    if (!data.remaining) {
      body.innerHTML = '<p class="red">No candidates match the detected feedback. Check the board or word list.</p>';
      return;
    }
    const rows = data.words.map((x, i) =>
      '<div class="word"><span>' + (i + 1) + '. ' + x.word.toUpperCase() +
      '</span><span>' + x.probability.toFixed(2) + '%</span></div>'
    ).join("");
    const letters = data.letters.map(x =>
      '<span class="chip">' + x.letter.toUpperCase() + ' ' + x.probability.toFixed(1) + '%</span>'
    ).join("");
    body.innerHTML = '<div class="muted">Guesses analyzed: ' + history.length +
      ' · Candidates: <b>' + data.remaining + '</b></div>' +
      '<div class="section">Top weighted suggestions</div>' + rows +
      '<div class="section">Letter probabilities</div><div class="chips">' +
      (letters || '<span class="muted">None</span>') + '</div>' +
      '<div class="section">Eliminated letters</div><div class="chips">' +
      (data.blackLetters.map(x => '<span class="chip">' + x.toUpperCase() + '</span>').join("") ||
      '<span class="muted">None</span>') + '</div>' +
      '<p class="muted">Scoring: 60% positional + 40% unique-letter frequency. Suggestions only; no guesses are entered automatically.</p>';
  }

  function update() {
    try {
      const history = getHistory();
      const signature = JSON.stringify(history);
      if (signature === lastSignature) return;
      lastSignature = signature;
      if (!history.length) { render([], null); return; }
      const engine = window.WordleGuesserEngine;
      if (!engine?.analyze) {
        ensurePanel();
        root.getElementById("body").textContent = "Wordle Guesser engine did not load. Reload the extension.";
        return;
      }
      render(history, engine.analyze(history));
    } catch (error) {
      ensurePanel();
      root.getElementById("body").textContent = "Could not read the board: " + (error?.message || String(error));
      console.error("[Wordle Guesser] board detection error:", error);
    }
  }

  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, {
    subtree: true, childList: true, attributes: true, characterData: true,
    attributeFilter: ["evaluation", "data-state", "data-status", "letter", "_letters", "_evaluation"]
  });
  ensurePanel();
  render([], null);
  update();
  // Polling is necessary because mutations inside nested Shadow DOM are not
  // observed by an observer attached only to document.documentElement.
  setInterval(update, 300);
})();