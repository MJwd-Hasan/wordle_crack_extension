/* Port of manual_player.py. Feedback uses Wordle's duplicate-letter rules. */
(() => {
  "use strict";
  const WORDS = window.WORDLE_GUESSER_WORDS || [];
  function getFeedback(guess, candidate) {
    const result = Array(5).fill("B");
    const remaining = Object.create(null);
    for (const ch of candidate) remaining[ch] = (remaining[ch] || 0) + 1;
    for (let i=0;i<5;i++) if (guess[i]===candidate[i]) { result[i]="G"; remaining[guess[i]]--; }
    for (let i=0;i<5;i++) if (result[i]==="B" && (remaining[guess[i]]||0)>0) { result[i]="Y"; remaining[guess[i]]--; }
    return result.join("");
  }
  function filterWords(guess, feedback, pool) {
    return pool.filter(word => getFeedback(guess, word) === feedback);
  }
  function computeLetterProbabilities(pool, blackLetters) {
    const n=pool.length;
    if (!n) return {overall:{}, positions:Array.from({length:5},()=>({}))};
    const counts=Object.create(null), positions=[];
    for (const word of pool) for (const ch of new Set(word)) counts[ch]=(counts[ch]||0)+1;
    const overall={};
    for (const [ch,count] of Object.entries(counts)) overall[ch]=blackLetters.has(ch)?0:count/n;
    for(let i=0;i<5;i++){
      const pc=Object.create(null);
      for(const word of pool) pc[word[i]]=(pc[word[i]]||0)+1;
      const probs={};
      for(const [ch,count] of Object.entries(pc)) probs[ch]=blackLetters.has(ch)?0:count/n;
      positions.push(probs);
    }
    return {overall,positions};
  }
  function scoreCandidates(pool, overall, positions) {
    if(!pool.length) return [];
    const raw=pool.map(word=>{
      const pos=word.split("").reduce((s,ch,i)=>s+(positions[i][ch]||0),0)/5;
      const unique=[...new Set(word)].reduce((s,ch)=>s+(overall[ch]||0),0)/5;
      return {word,score:.6*pos+.4*unique};
    });
    const total=raw.reduce((s,x)=>s+x.score,0);
    if(total<=0) return raw.map(x=>({word:x.word,probability:100/pool.length}));
    return raw.map(x=>({word:x.word,probability:x.score/total*100})).sort((a,b)=>b.probability-a.probability);
  }
  function analyze(history) {
    let candidates=WORDS.slice();
    const confirmed=new Set(), black=new Set();
    for(const {guess,feedback} of history){
      for(let i=0;i<5;i++){
        const ch=guess[i], fb=feedback[i];
        if(fb==="G"||fb==="Y"){confirmed.add(ch);black.delete(ch);}
        else if(!confirmed.has(ch)) black.add(ch);
      }
      candidates=filterWords(guess,feedback,candidates);
    }
    const {overall,positions}=computeLetterProbabilities(candidates,black);
    const letters=Object.entries(overall).filter(([,p])=>p>0).sort((a,b)=>b[1]-a[1]).slice(0,15).map(([letter,p])=>({letter,probability:p*100}));
    const ranked=scoreCandidates(candidates,overall,positions);
    return {remaining:candidates.length,blackLetters:[...black].sort(),letters,words:ranked.slice(0,25),solved:history.some(x=>x.feedback==="GGGGG"),vocabularySize:WORDS.length};
  }
  window.WordleGuesserEngine={analyze,getFeedback};
})();