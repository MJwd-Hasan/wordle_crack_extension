(() => {
  "use strict";
  let lastSignature = "", panel, root, lastDiagnostics = null;

  // Traverse the light DOM and every accessible nested Shadow DOM.
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
      absent: "B", gray: "B", grey: "B", wrong: "B", black: "B", b: "B",
      closed: "G"
    };
    const key = String(value ?? "").trim().toLowerCase();
    return map[key] || (["G", "Y", "B"].includes(key.toUpperCase()) ? key.toUpperCase() : "");
  }

  function letterFromLabel(label) {
    const s = String(label || "").trim();
    let m = s.match(/(?:letter[, :]+)?([a-z])(?:[, .:]|$)/i);
    if (m) return m[1].toLowerCase();
    m = s.match(/\b([a-z])\s*,\s*(?:correct|present|absent|green|yellow|gray|grey)\b/i);
    return m ? m[1].toLowerCase() : "";
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

  function readTile(tile) {
    const label = tile.getAttribute?.("aria-label") || "";
    let state = "";
    for (const attr of ["evaluation", "data-state", "data-status", "status"]) {
      state = tile.getAttribute?.(attr) || "";
      if (state) break;
    }
    let feedback = normalizeFeedback(state);
    if (!feedback && label) {
      const match = label.match(/\b(correct|present|absent|green|yellow|gray|grey|closed)\b/i);
      if (match) feedback = normalizeFeedback(match[1]);
    }
    if (!feedback && tile.classList) {
      for (const cls of tile.classList) {
        const match = cls.match(/(correct|present|absent|green|yellow|gray|grey|closed)/i);
        if (match) { feedback = normalizeFeedback(match[1]); break; }
      }
    }
    const letter = (
      tile.getAttribute?.("letter") ||
      tile.getAttribute?.("data-letter") ||
      letterFromLabel(label) ||
      tile.textContent ||
      ""
    ).trim().toLowerCase();
    return { letter, feedback };
  }

  function validRow(tiles) {
    if (!tiles || tiles.length !== 5) return null;
    const guess = tiles.map(t => t.letter).join("");
    const feedback = tiles.map(t => t.feedback).join("");
    if (!/^[a-z]{5}$/.test(guess) || !/^[GYB]{5}$/.test(feedback)) return null;
    return { guess, feedback };
  }

  function getHistory() {
    const elements = allElements();
    const history = [], seen = new Set();
    let rowCount = 0, tileCount = 0, evaluatedTileCount = 0;

    function add(row) {
      if (!row) return;
      const key = row.guess + ":" + row.feedback;
      if (!seen.has(key)) { history.push(row); seen.add(key); }
    }

    // NYT Wordle: CSS-module rows containing data-testid="tile".
    // The tile's letter is commonly exposed through aria-label, while
    // data-state is correct/present/absent.
    const nytRows = elements.filter(el =>
      typeof el.className === "string" && el.className.includes("Row-module_row")
    );
    for (const row of nytRows) {
      rowCount++;
      const tiles = Array.from(row.querySelectorAll?.('[data-testid="tile"]') || []);
      tileCount += tiles.length;
      const parsed = tiles.map(readTile);
      evaluatedTileCount += parsed.filter(t => t.feedback).length;
      add(validRow(parsed));
    }

    // Archive / classic Wordle web components: game-app > game-row >
    // game-tile. The row's submitted word is often in the "letters" attribute.
    const gameRows = elements.filter(el => /^(GAME-ROW|WORDLE-ROW)$/.test(el.tagName || ""));
    for (const row of gameRows) {
      rowCount++;
      const scope = row.shadowRoot || row;
      const tiles = Array.from(scope.querySelectorAll?.("game-tile, wordle-tile") || []);
      tileCount += tiles.length;
      const parsed = tiles.map(readTile);
      evaluatedTileCount += parsed.filter(t => t.feedback).length;
      let result = validRow(parsed);
      if (!result) {
        const letters = String(
          row.getAttribute?.("letters") ||
          row.getAttribute?.("_letters") ||
          row._letters ||
          row.letters ||
          ""
        ).trim().toLowerCase();
        const evaluations = parseArrayLike(
          row.getAttribute?.("_evaluation") || row._evaluation || row.evaluation
        );
        if (/^[a-z]{5}$/.test(letters) && evaluations?.length === 5) {
          result = validRow(letters.split("").map((letter, i) => ({
            letter, feedback: normalizeFeedback(evaluations[i])
          })));
        }
      }
      add(result);
    }

    // Generic archive / clone fallback: group recognized tiles by their row
    // container. This also covers variants that do not use custom elements.
    const genericTiles = elements.filter(el => el.matches?.(
      '[data-testid="tile"], [data-state], [data-status], [data-letter], [evaluation], .tile, [role="gridcell"]'
    ));
    const groups = new Map();
    for (const tile of genericTiles) {
      if (tile.closest?.("#wordle-guesser-overlay")) continue;
      const parent = tile.parentElement;
      if (!parent) continue;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(tile);
    }
    for (const group of groups.values()) {
      if (group.length < 5) continue;
      rowCount++;
      const parsed = group.slice(0, 5).map(readTile);
      tileCount += group.length;
      evaluatedTileCount += parsed.filter(t => t.feedback).length;
      add(validRow(parsed));
    }

    lastDiagnostics = {
      host: location.hostname,
      rows: rowCount,
      tiles: tileCount,
      evaluated: evaluatedTileCount,
      guesses: history.length
    };
    return history;
  }

  function ensurePanel() {
    if (panel?.isConnected) return;
    panel = document.createElement("div");
    panel.id = "wordle-guesser-overlay";
    Object.assign(panel.style, {
      position: "fixed", right: "16px", bottom: "16px",
      zIndex: "2147483647", width: "min(380px,calc(100vw - 32px))"
    });
    root = panel.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      *{box-sizing:border-box}.card{font:13px/1.45 system-ui,sans-serif;color:#202124;background:#fff;border:1px solid #d9dce1;border-radius:14px;box-shadow:0 8px 32px #0003;overflow:hidden}
      header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#202124;color:white;font-weight:700}
      button{border:0;background:transparent;color:inherit;font-size:18px;cursor:pointer}.body{padding:12px 14px;max-height:55vh;overflow:auto}
      .muted{color:#687078}.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.chip{background:#f0f2f4;border-radius:6px;padding:4px 7px;font-variant-numeric:tabular-nums}
      .word{display:flex;justify-content:space-between;padding:6px 8px;border-bottom:1px solid #eee}.word:first-child{font-weight:700;background:#f4f7f4}
      .section{margin-top:12px;font-weight:700}.red{color:#b42318}.diag{font-size:11px;color:#687078;margin-top:10px;border-top:1px solid #eee;padding-top:7px}
    </style><div class="card"><header><span>Wordle Guesser</span><button id="close" aria-label="Close">×</button></header><div class="body" id="body"></div></div>`;
    root.getElementById("close").addEventListener("click", () => panel.remove());
    document.documentElement.appendChild(panel);
  }

  function diagnosticText() {
    const d = lastDiagnostics || { host: location.hostname, rows: 0, tiles: 0, evaluated: 0 };
    return '<div class="diag">Site: ' + d.host + '<br>Board rows: ' + d.rows +
      ' · tiles: ' + d.tiles + ' · colored: ' + d.evaluated +
      '<br>If a submitted row is colored but guesses remain 0, this site uses an unsupported board layout.</div>';
  }

  function render(history, data) {
    ensurePanel();
    const body = root.getElementById("body");
    if (!history.length) {
      body.innerHTML = '<span class="muted">Waiting for a completed guess…</span>' + diagnosticText();
      return;
    }
    if (!data.remaining) {
      body.innerHTML = '<p class="red">A completed row was read, but no candidate words match it. The detected feedback is shown below so we can check the parser.</p>' +
        '<div class="chips">' + history.map(h => '<span class="chip">' + h.guess.toUpperCase() + ' · ' + h.feedback + '</span>').join("") + '</div>' +
        diagnosticText();
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
      '<p class="muted">Scoring: 60% positional + 40% unique-letter frequency. Suggestions only; no guesses are entered automatically.</p>' +
      diagnosticText();
  }

  function update() {
    try {
      const history = getHistory();
      const signature = JSON.stringify({ history, diagnostics: lastDiagnostics });
      if (signature === lastSignature) return;
      lastSignature = signature;
      const engine = window.WordleGuesserEngine;
      if (history.length && !engine?.analyze) {
        ensurePanel();
        root.getElementById("body").textContent = "Wordle Guesser engine did not load. Reload the extension.";
        return;
      }
      render(history, history.length ? engine.analyze(history) : null);
    } catch (error) {
      ensurePanel();
      root.getElementById("body").textContent = "Could not read the board: " + (error?.message || String(error));
      console.error("[Wordle Guesser] board detection error:", error);
    }
  }

  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, {
    subtree: true, childList: true, attributes: true, characterData: true
  });
  ensurePanel();
  update();
  // Poll for feedback revealed inside shadow roots or updated by framework state.
  setInterval(update, 300);
})();