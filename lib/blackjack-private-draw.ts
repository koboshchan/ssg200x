// Server-only policy: this module is reachable only through the Node blackjack engine.
// Never import it from a client or accept a seed/policy selector from a request.
import {randomInt} from "node:crypto";
export type PrivateRandom=(max:number)=>number;
export const BLACKJACK_DRAW_POLICY="weighted-stiff-v1";
const ranks=[..."23456789TJQKA"];
const value=(rank:string)=>rank==="A"?11:"TJQK".includes(rank)?10:Number(rank);
export function privateBlackjackShoe():string[]{return Array.from({length:6},()=>[..."shcd"].flatMap(s=>ranks.map(v=>v+s))).flat();}
function choose<T>(items:T[],rng:PrivateRandom):T{if(!items.length)throw Error("Private blackjack shoe exhausted");return items[rng(items.length)];}
function take(shoe:string[],card:string):string{const i=shoe.indexOf(card);if(i<0)throw Error("Private blackjack card unavailable");return shoe.splice(i,1)[0];}
/** 80% severity-weighted stiffs, 20% lower-severity stiffs. All totals 12..16,
 * no aces/natural or Black 78. Dealer upcard only, never its hidden card.
 * Weak upcards prefer hard 12; strong upcards prefer hard 16. Lower-weight
 * totals remain possible in both branches, avoiding a fixed hand/rank/suit.
 */
export function privateBlackjackStart(shoe:string[],upcard:string,rng:PrivateRandom=randomInt){
 const weak=value(upcard[0])<=6,mild=rng(5)===0;
 const available=ranks.filter(r=>r!=="A"&&shoe.some(c=>c[0]===r));
 const candidates:{ranks:[string,string];weight:number}[]=[];
 for(const a of available)for(const b of available){
  if(a===b&&shoe.filter(c=>c[0]===a).length<2)continue;
  const total=value(a)+value(b);if(total<12||total>16)continue;
  const severity=weak?16-total:total-12;
  candidates.push({ranks:[a,b],weight:1+(mild?4-severity:severity)**2});
 }
 let ticket=rng(candidates.reduce((n,c)=>n+c.weight,0));let selected=candidates[0];
 for(const c of candidates){ticket-=c.weight;if(ticket<0){selected=c;break;}}
 if(!selected)throw Error("No private blackjack starting pair");
 const cards:string[]=[];
 for(const rank of selected.ranks){
  const options=shoe.filter(c=>c[0]===rank&&!(cards.length===1&&[cards[0][0],rank].sort().join("")==="78"&&["s","c"].includes(cards[0][1])&&["s","c"].includes(c[1])));
  cards.push(take(shoe,choose(options,rng)));
 }
 return {cards,branch:mild?"mild":"severe",policy:BLACKJACK_DRAW_POLICY};
}
/** Select among the most damaging available ranks, using only this player's
 * hand and independent persisted shoe. 20% of draws use the next-worst score
 * when one exists. Tied cards/ranks/suits use private server randomness.
 */
export function privateBlackjackHit(shoe:string[],cards:string[],rng:PrivateRandom=randomInt){
 const total=(cs:string[])=>{let n=0,aces=0;for(const c of cs){n+=value(c[0]);if(c[0]==="A")aces++;}while(n>21&&aces-->0)n-=10;return n;};
 const scored=shoe.map(card=>{const n=total([...cards,card]);return {card,score:n>21?1000+n:21-n};});
 const levels=[...new Set(scored.map(c=>c.score))].sort((a,b)=>b-a);
 const mild=rng(5)===0&&levels.length>1,score=levels[mild?1:0];
 const selected=choose(scored.filter(c=>c.score===score),rng);
 return {card:take(shoe,selected.card),branch:mild?"mild":"severe",policy:BLACKJACK_DRAW_POLICY};
}
