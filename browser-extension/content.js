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

    // Prefer native board parsers when recognized. Combining parser families can
    // read one row differently and add contradictory constraints, hiding valid answers.
    if (!nytRows.length && !gameRows.length) {
      // Generic archive / clone fallback: group recognized tiles by their row
      // container. This also covers variants that do not use custom elements.
      const genericTiles = elements.filter(el => el.matches?.(
        '[data-testid="tile"], [data-state], [data-status], [data-letter], [evaluation], .tile, [class*="tile" i], [role="gridcell"]'
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
        if (group.length !== 5) continue;
        rowCount++;
        const parsed = group.slice(0, 5).map(readTile);
        tileCount += group.length;
        evaluatedTileCount += parsed.filter(t => t.feedback).length;
        add(validRow(parsed));
      }


      if (!history.length) {
      // CSS-module fallback: some NYT builds expose Tile-module_tile classes
      // without data-testid/data-state attributes. Cluster five tile-like
      // descendants under their nearest shared row container.
      const tileLike = elements.filter(el =>
        /tile/i.test(typeof el.className === "string" ? el.className : "") &&
        !el.closest?.("#wordle-guesser-overlay")
      );
      const tileSet = new Set(tileLike);
      const candidateRows = new Set();
      for (const tile of tileLike) {
        let ancestor = tile.parentElement;
        for (let depth = 0; ancestor && depth < 5; depth++, ancestor = ancestor.parentElement) {
          const descendants = Array.from(ancestor.querySelectorAll?.("*") || [])
            .filter(el => tileSet.has(el));
          if (descendants.length === 5) {
            candidateRows.add(ancestor);
            break;
          }
          if (descendants.length > 5) break;
        }
      }
      for (const row of candidateRows) {
        rowCount++;
        const tiles = Array.from(row.querySelectorAll("*")).filter(el => tileSet.has(el));
        tileCount += tiles.length;
        const parsed = tiles.map(readTile);
        evaluatedTileCount += parsed.filter(t => t.feedback).length;
        add(validRow(parsed));
      }


      }
    }

    const boardLike = elements.filter(el => {
      const cls = typeof el.className === "string" ? el.className : "";
      return /board|grid|row|tile/i.test(cls);
    });
    lastDiagnostics = {
      host: location.hostname,
      rows: rowCount,
      tiles: tileCount,
      evaluated: evaluatedTileCount,
      guesses: history.length,
      boardLike: boardLike.length,
      sampleClasses: boardLike.slice(0, 8).map(el =>
        String(el.className || el.tagName).slice(0, 65)
      )
    };
    return history;
  }

  function ensurePanel() {
    if (panel?.isConnected) return;
    panel = document.createElement("div");
    panel.id = "wordle-guesser-overlay";
    Object.assign(panel.style, {
      position: "fixed", right: "16px", bottom: "16px",
      zIndex: "2147483647", width: "min(430px,calc(100vw - 32px))"
    });
    root = panel.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      *{box-sizing:border-box}
      .card{font:13px/1.45 Inter,ui-sans-serif,system-ui,sans-serif;color:#1c2926;background:#fbfcfa;border:1px solid #dce5df;border-radius:18px;box-shadow:0 14px 42px #14231d35;overflow:hidden}
      header{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;background:#18332b;color:#fff}
      .brand{display:flex;align-items:center;gap:10px}.mark{width:28px;height:28px;border-radius:9px;background:#d8f1df;color:#18332b;display:grid;place-items:center;font-weight:900}
      .brand strong{display:block;font-size:14px;letter-spacing:.1px}.brand small{display:block;color:#b8d1c4;font-size:10px;letter-spacing:1.1px}
      button{border:0;background:transparent;color:inherit;font-size:21px;cursor:pointer;line-height:1}
      .body{padding:14px 15px;max-height:68vh;overflow:auto}
      .muted{color:#65736d}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:14px}
      .stat{border:1px solid #e1e9e4;border-radius:11px;padding:8px 9px;background:#fff}
      .stat b{display:block;font-size:17px;line-height:1.2;color:#1d392e}.stat span{font-size:10px;color:#68766f}
      .section{display:flex;align-items:center;justify-content:space-between;margin:13px 0 7px;font-weight:750;font-size:12px;color:#293d34}
      .section small{font-size:10px;font-weight:500;color:#78847e}
      .word{display:grid;grid-template-columns:76px 1fr;gap:8px;align-items:center;padding:8px 9px;border:1px solid #e6ece8;border-radius:10px;background:#fff;margin:5px 0}
      .wordname{font-weight:850;letter-spacing:1.3px;font-size:14px}.metrics{font-size:10px;color:#65736d}
      .tag{display:inline-block;font-size:9px;border-radius:5px;padding:2px 5px;margin-left:4px;background:#e7f2eb;color:#28553f;letter-spacing:.2px}
      .tag.probe{background:#eef0f7;color:#4b5279}.answers{display:flex;flex-wrap:wrap;gap:6px}
      .answer{border:1px solid #e0e8e2;background:#fff;border-radius:8px;padding:6px 8px;min-width:65px}
      .answer b{display:block;letter-spacing:1px;font-size:12px}.answer span{font-size:9px;color:#748078}
      .chips{display:flex;flex-wrap:wrap;gap:5px}.chip{background:#edf2ee;border-radius:7px;padding:4px 7px;font-size:11px;font-variant-numeric:tabular-nums}
      .history{font-size:10px;letter-spacing:.7px}.empty{padding:12px;border:1px dashed #cbd8d0;border-radius:11px;color:#64736b;background:#fff}
      .notice{padding:9px 10px;border-radius:10px;background:#f1f5f2;color:#5d6d64;font-size:10px;margin-top:10px}
      .error{color:#a33232;background:#fff2f1;border:1px solid #f0d4d1;padding:10px;border-radius:10px}
      .diag{font-size:10px;color:#89948e;margin-top:10px;border-top:1px solid #e6ece8;padding-top:8px;overflow-wrap:anywhere}
      .footer{font-size:10px;color:#78847e;margin-top:12px;text-align:center}
    </style><div class="card"><header><div class="brand"><span class="mark">W</span><div><strong>Wordle Guesser</strong><small>LIVE ANSWER FILTER · V2.0.1</small></div></div><button id="close" aria-label="Close">×</button></header><div class="body" id="body"></div></div>`;
    root.getElementById("close").addEventListener("click", () => panel.remove());
    document.documentElement.appendChild(panel);
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    })[ch]);
  }

  function diagnosticText() {
    const d = lastDiagnostics || { host: location.hostname, rows: 0, tiles: 0, evaluated: 0 };
    const samples = (d.sampleClasses || []).map(escapeHTML).join(" · ");
    return '<div class="diag">Detector: ' + escapeHTML(d.host) +
      ' · rows ' + (d.rows || 0) + ' · tiles ' + (d.tiles || 0) +
      ' · feedback ' + (d.evaluated || 0) +
      (samples ? '<br>Board elements: ' + samples : '') + '</div>';
  }

  function render(history, data) {
    ensurePanel();
    const body = root.getElementById("body");
    if (!history.length) {
      body.innerHTML = '<div class="empty">Make a guess and submit it to see the remaining possible answers.</div>' + diagnosticText();
      return;
    }
    const historyMarkup = '<div class="chips history">' + history.map(h =>
      '<span class="chip">' + escapeHTML(h.guess.toUpperCase()) + ' · ' + escapeHTML(h.feedback) + '</span>'
    ).join("") + '</div>';
    if (data.noMatches) {
      body.innerHTML = '<div class="error"><b>No dictionary answers match all detected feedback.</b><br>The board may have been read incorrectly, or the game may use an answer missing from the bundled dictionary. Check the detected rows below; your Wordle board has not been changed.</div>' +
        historyMarkup + diagnosticText();
      return;
    }
    const answerRows = data.possibleAnswers.map(item =>
      '<div class="answer"><b>' + escapeHTML(item.word.toUpperCase()) + '</b><span>' +
      item.chance.toFixed(item.chance < 1 ? 2 : 1) + '% of list</span></div>'
    ).join("");
    const letterRows = data.letters.map(item =>
      '<span class="chip">' + item.letter.toUpperCase() + ' ' + item.probability.toFixed(1) + '%</span>'
    ).join("");
    const blackRows = data.blackLetters.map(ch =>
      '<span class="chip">' + ch.toUpperCase() + '</span>'
    ).join("");
    body.innerHTML =
      '<div class="stats"><div class="stat"><b>' + data.remaining.toLocaleString() + '</b><span>matching answers</span></div>' +
      '<div class="stat"><b>' + data.vocabularySize.toLocaleString() + '</b><span>answer dictionary</span></div>' +
      '<div class="stat"><b>' + history.length + '</b><span>submitted guesses</span></div></div>' +
      (data.solved ? '<div class="empty"><b>Congratulations — the answer was found!</b></div>' : '') +
      '<div class="section">Possible answers <small>showing ' + data.shownAnswerCount + ' of ' + data.remaining + '</small></div>' +
      '<div class="answers">' + (answerRows || '<span class="muted">None</span>') + '</div>' +
      (data.remaining > data.shownAnswerCount
        ? '<div class="notice">The list is limited to the first 50 matching words. Every displayed word satisfies all detected green, yellow, and gray feedback.</div>'
        : '') +
      '<div class="section">Letter frequency <small>share of candidates containing each letter</small></div>' +
      '<div class="chips">' + (letterRows || '<span class="muted">None</span>') + '</div>' +
      '<div class="section">Eliminated letters</div><div class="chips">' +
      (blackRows || '<span class="muted">None</span>') + '</div>' +
      '<div class="notice">Candidates are checked against every submitted row using Wordle’s duplicate-letter rules. “% of list” assumes all remaining dictionary entries are equally likely; it is not an official NYT answer probability.</div>' +
      historyMarkup +
      '<div class="footer">Filtered locally in your browser · no guesses are entered automatically</div>' +
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