(() => {
  "use strict";
  const HISTORY_KEY="__wordleGuesserHistory";
  let lastSignature="", panel, root;
  function allElements(start=document) {
    const out=[], seen=new Set(), stack=[start];
    while(stack.length){const node=stack.pop(); if(!node||seen.has(node))continue; seen.add(node);
      if(node.querySelectorAll) for(const el of node.querySelectorAll("*")){out.push(el); if(el.shadowRoot)stack.push(el.shadowRoot);}
      if(node.host){} 
    }
    return out;
  }
  function readTile(tile) {
    const attrs=["evaluation","data-state","data-status","status"];
    let state=""; for(const a of attrs){state=tile.getAttribute?.(a)||"";if(state)break;}
    const map={correct:"G",present:"Y",absent:"B",green:"G",yellow:"Y",gray:"B",grey:"B",g:"G",y:"Y",b:"B"};
    const feedback=map[state.toLowerCase()] || (["G","Y","B"].includes(state.toUpperCase())?state.toUpperCase():"");
    const letter=(tile.getAttribute?.("letter")||tile.getAttribute?.("data-letter")||tile.textContent||"").trim().toLowerCase();
    return {letter,feedback};
  }
  function findRows() {
    const elements=allElements();
    const rows=elements.filter(el=>/^(GAME-ROW|WORDLE-ROW)$/.test(el.tagName||""));
    const result=[];
    for(const row of rows){
      const scope=row.shadowRoot||row;
      let tiles=Array.from(scope.querySelectorAll?.("game-tile, [data-state], [evaluation], .tile, .letter")||[]);
      tiles=tiles.filter(t=>readTile(t).letter.length>0);
      if(tiles.length>=5) result.push(tiles.slice(0,5));
    }
    if(result.length) return result;
    // Fallback for archive implementations using ordinary DOM tile elements.
    const candidates=elements.filter(el=>el.matches?.("[data-state][data-letter], .tile[data-state], .tile[data-status]"));
    const groups=new Map();
    for(const el of candidates){const key=el.parentElement; if(!groups.has(key))groups.set(key,[]);groups.get(key).push(el);}
    return [...groups.values()].filter(g=>g.length>=5).map(g=>g.slice(0,5));
  }
  function getHistory(){
    const history=[];
    for(const row of findRows()){
      const tiles=row.map(readTile);
      if(tiles.length!==5||tiles.some(t=>! /^[a-z]$/.test(t.letter)||!t.feedback)) continue;
      history.push({guess:tiles.map(t=>t.letter).join(""),feedback:tiles.map(t=>t.feedback).join("")});
    }
    return history;
  }
  function ensurePanel(){
    if(panel?.isConnected)return;
    panel=document.createElement("div");
    panel.id="wordle-guesser-overlay";
    Object.assign(panel.style,{position:"fixed",right:"16px",bottom:"16px",zIndex:"2147483647",width:"min(360px,calc(100vw - 32px))"});
    root=panel.attachShadow({mode:"open"});
    root.innerHTML=`<style>
      *{box-sizing:border-box} .card{font:13px/1.45 system-ui,sans-serif;color:#202124;background:#fff;border:1px solid #d9dce1;border-radius:14px;box-shadow:0 8px 32px #0003;overflow:hidden}
      header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#202124;color:white;font-weight:700}
      button{border:0;background:transparent;color:inherit;font-size:18px;cursor:pointer}.body{padding:12px 14px;max-height:55vh;overflow:auto}
      .muted{color:#687078}.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.chip{background:#f0f2f4;border-radius:6px;padding:4px 7px;font-variant-numeric:tabular-nums}
      .word{display:flex;justify-content:space-between;padding:6px 8px;border-bottom:1px solid #eee}.word:first-child{font-weight:700;background:#f4f7f4}
      .section{margin-top:12px;font-weight:700}.green{color:#16834a}.red{color:#b42318}
    </style><div class="card"><header><span>Wordle Guesser</span><button id="close" aria-label="Close">×</button></header><div class="body" id="body"><span class="muted">Waiting for a completed guess…</span></div></div>`;
    root.getElementById("close").addEventListener("click",()=>panel.remove());
    document.documentElement.appendChild(panel);
  }
  function render(history, data){
    ensurePanel(); const body=root.getElementById("body");
    if(!history.length){body.innerHTML='<span class="muted">Play a guess to see live analysis.</span>';return;}
    if(!data.remaining){body.innerHTML='<p class="red">No candidates match the detected feedback. Check the board or word list.</p>';return;}
    const rows=data.words.map((x,i)=>'<div class="word"><span>'+(i+1)+'. '+x.word.toUpperCase()+'</span><span>'+x.probability.toFixed(2)+'%</span></div>').join("");
    const letters=data.letters.map(x=>'<span class="chip">'+x.letter.toUpperCase()+' '+x.probability.toFixed(1)+'%</span>').join("");
    body.innerHTML='<div class="muted">Guesses analyzed: '+history.length+' · Candidates: <b>'+data.remaining+'</b></div>'+
      '<div class="section">Top weighted suggestions</div>'+rows+
      '<div class="section">Letter probabilities</div><div class="chips">'+(letters||'<span class="muted">None</span>')+'</div>'+
      '<div class="section">Eliminated letters</div><div class="chips">'+(data.blackLetters.map(x=>'<span class="chip">'+x.toUpperCase()+'</span>').join("")||'<span class="muted">None</span>')+'</div>'+
      '<p class="muted">Scoring: 60% positional + 40% unique-letter frequency. Suggestions only; no guesses are entered automatically.</p>';
  }
  function update(){
    const history=getHistory();
    const signature=JSON.stringify(history);
    if(signature===lastSignature)return;
    lastSignature=signature;
    if(!history.length){render([],null);return;}
    render(history,window.WordleGuesserEngine.analyze(history));
  }
  const observer=new MutationObserver(()=>update());
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true,attributeFilter:["evaluation","data-state","data-status","letter"]});
  // The game board is rendered inside nested Shadow DOM. A MutationObserver on
  // documentElement cannot see mutations inside those shadow roots, so poll the
  // visible board as well. This also catches late-loading game components.
  ensurePanel();
  render([],null);
  update();
  setInterval(update,500);
})();