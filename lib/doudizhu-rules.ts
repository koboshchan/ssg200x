/**
 * Single-deck, three-player Dou Dizhu (Pagat rules).
 * Cards use poker notation (T, not 10), with X/Y the small/big jokers.
 * rank is the highest core rank; length counts core groups, size all cards.
 * Airplane single wings may share a rank, but may not use a core rank or
 * both jokers. Pair wings must have distinct ranks. Four+singles requires
 * distinct wing ranks. Pure airplanes take precedence over winged parses.
 */
export type Combo = {kind:string;rank:number;length:number;size:number};
const RANKS = "3456789TJQKA2";
const SUITS = "shdc";

export function rank(card:string):number {
  if(card==="X") return 16;
  if(card==="Y") return 17;
  if(typeof card!=="string" || card.length!==2 || !SUITS.includes(card[1])) return -1;
  const index=RANKS.indexOf(card[0]);
  return index<0 ? -1 : index+3;
}

/** Rejection sampling through Web Crypto, followed by unbiased Fisher-Yates. */
export function shuffled():string[] {
  const deck=[...RANKS].flatMap(r=>[...SUITS].map(s=>r+s)).concat(["X","Y"]);
  const word=new Uint32Array(1);
  for(let i=deck.length-1;i>0;i--){
    const bound=i+1,limit=0x100000000-(0x100000000%bound);
    let value:number;
    do { globalThis.crypto.getRandomValues(word);value=word[0]; } while(value>=limit);
    const j=value%bound;
    [deck[i],deck[j]]=[deck[j],deck[i]];
  }
  return deck;
}

export function classify(cards:string[]):Combo|null {
  if(!Array.isArray(cards)||cards.length===0||cards.length>20||new Set(cards).size!==cards.length) return null;
  const counts=new Map<number,number>();
  for(const card of cards){
    const r=rank(card);
    if(r<0) return null;
    counts.set(r,(counts.get(r)??0)+1);
  }
  const entries=[...counts].sort((a,b)=>a[0]-b[0]),size=cards.length;
  const combo=(kind:string,r:number,length=1):Combo=>({kind,rank:r,length,size});
  const run=(multiplicity:number,min:number):boolean=>
    entries.length>=min && entries.at(-1)![0]<=14 &&
    entries.every(([r,n],i)=>n===multiplicity&&(i===0||r===entries[i-1][0]+1));
  if(size===1) return combo("single",entries[0][0]);
  if(size===2&&counts.has(16)&&counts.has(17)) return combo("rocket",17);
  if(entries.length===1){
    const kinds:Record<number,string>={2:"pair",3:"triple",4:"bomb"};
    return kinds[size]?combo(kinds[size],entries[0][0]):null;
  }
  if(size===4||size===5){
    const core=entries.find(([,n])=>n===3);
    if(core && entries.length===2) return combo(size===4?"triple-single":"triple-pair",core[0]);
  }
  if(run(1,5)) return combo("straight",entries.at(-1)![0],entries.length);
  if(run(2,3)) return combo("pair-straight",entries.at(-1)![0],entries.length);
  if(run(3,2)) return combo("airplane",entries.at(-1)![0],entries.length);
  // Attached jokers cannot jointly smuggle the rocket into another play.
  if(counts.has(16)&&counts.has(17)) return null;
  if(size===6||size===8){
    const quad=entries.find(([,n])=>n===4);
    const wings=entries.filter(([r])=>r!==quad?.[0]);
    if(quad&&wings.length===2&&wings.every(([,n])=>n===(size===6?1:2)))
      return combo(size===6?"four-single":"four-pair",quad[0]);
  }
  for(const [unit,kind] of [[4,"airplane-single"],[5,"airplane-pair"]] as const){
    const length=size/unit;
    if(!Number.isInteger(length)||length<2||length>12) continue;
    // Descending scan gives deterministic highest-core precedence if more
    // than one single-wing decomposition exists.
    for(let high=14;high>=3+length-1;high--){
      const low=high-length+1;
      if(!Array.from({length},(_,i)=>counts.get(low+i)).every(n=>n===3)) continue;
      const wings=entries.filter(([r])=>r<low||r>high);
      if(unit===4 && wings.reduce((sum,[,n])=>sum+n,0)===length)
        return combo(kind,high,length);
      if(unit===5 && wings.length===length && wings.every(([,n])=>n===2))
        return combo(kind,high,length);
    }
  }
  return null;
}

/** Compare descriptors returned by classify, never client-provided claims. */
export function beats(play:Combo,previous:Combo):boolean {
  if(previous.kind==="rocket") return false;
  if(play.kind==="rocket") return true;
  if(play.kind==="bomb") return previous.kind!=="bomb"||play.rank>previous.rank;
  if(previous.kind==="bomb") return false;
  return play.kind===previous.kind&&play.length===previous.length&&play.size===previous.size&&play.rank>previous.rank;
}
