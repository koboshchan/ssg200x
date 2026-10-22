import {randomInt} from "node:crypto";
import {audit} from "./audit";
import {casinoLimits} from "./casino-limits";
import {isWholeCasinoAmount} from "./casino-amount";
import {checkFinanceRequest,recordFinanceRequest,type FinanceInput} from "./finance-requests";
import {register} from "./poker";
import {ensure} from "./errors";
import type {Room,Identity} from "./types";
export type MiniKind="plinko"|"hilo"|"mines"|"dice"|"chicken";
export type MiniGame={id:string;owner:string;kind:MiniKind;bet:number;status:"active"|"won"|"lost"|"cashed";revision:number;steps:number;payout:number;createdAt:number;num:number;den:number;card?:number;cards?:number[];revealed?:number[];mines?:number;bombs?:number[];target?:number;direction?:"over"|"under";result?:{path?:number[];slot?:number;roll?:number;hit?:number;card?:number}};
export type MiniInput=FinanceInput&({type:"start";game:MiniKind;amount:number;mines?:number;target?:number;direction?:"over"|"under"}|{type:"step";id:string;revision:number;cell?:number;choice?:"high"|"low"}|{type:"cashout";id:string;revision:number});
export const CHICKEN_LANES=15;
export const PLINKO_WEIGHTS=[16,4,2,1,0.5,1,2,4,16] as const;
// Binomial weights sum to 256; weighted raw payout is 355/256. Scale to 98% RTP.

export function miniAssets(r:Room,owner?:string){return (r.miniGames??[]).reduce((sum,g)=>sum+(g.status==="active"&&(!owner||g.owner===owner)?g.bet:0),0);}
function fraction(g:MiniGame,n:number,d:number){
 const a=BigInt(g.num)*BigInt(n),b=BigInt(g.den)*BigInt(d);
 function gcd(x:bigint,y:bigint):bigint{return y===0n?x:gcd(y,x%y);}
 const k=gcd(a,b);g.num=Number(a/k);g.den=Number(b/k);
 ensure(Number.isSafeInteger(g.num)&&Number.isSafeInteger(g.den),"Invalid game odds.",500);
}
export function miniPayout(g:MiniGame){const n=Number(BigInt(g.bet)*BigInt(g.num)/BigInt(g.den));ensure(Number.isSafeInteger(n)&&n>=0,"Invalid game payout.",500);return n;}
function settle(r:Room,g:MiniGame,status:MiniGame["status"]){
 const m=r.members.find(m=>m.id===g.owner)!;
 g.status=status;g.payout=status==="lost"?0:miniPayout(g);
 ensure(Number.isSafeInteger(m.wallet+g.payout)&&Number.isSafeInteger((r.house??0)+g.bet-g.payout),"Wallet limit reached.",409);
 m.wallet+=g.payout;r.house=(r.house??0)+g.bet-g.payout;
 m.activity=[`${g.kind} · ${g.status} · $${(g.payout/100).toFixed(2)} returned`,...(m.activity??[])].slice(0,200);
}
function chickenStep(r:Room,g:MiniGame,rng:(max:number)=>number){
 g.steps++;
 if(rng(5)===0){g.result={hit:g.steps};settle(r,g,"lost");}
 else{fraction(g,5,4);if(g.steps===CHICKEN_LANES)settle(r,g,"won");}
}
function report(g:MiniGame){
 // Explicit allowlist. Only a lost Mines round reveals its board to its owner.
 // Active/cashed boards, owner IDs and rational internals stay private.
 return {id:g.id,kind:g.kind,bet:g.bet,status:g.status,revision:g.revision,steps:g.steps,multiplier:g.num/g.den,payout:g.status==="active"?miniPayout(g):g.payout,createdAt:g.createdAt,...(g.card!==undefined?{card:g.card,cards:g.cards}:{}),...(g.revealed?{revealed:g.revealed,mines:g.mines}:{}),...(g.kind==="mines"&&g.status==="lost"?{bombs:[...(g.bombs??[])]}:{}),...(g.target?{target:g.target,direction:g.direction}:{}),...(g.result?{result:g.result}:{})};
}
export function miniSnapshot(r:Room,who:Identity){const m=r.members.find(m=>m.id===who.id);ensure(m&&!m.accessRevoked,"Room access revoked.",403);return {version:r.version,wallet:m.wallet,maxBet:casinoLimits(r).gamesMaxBet,serverNow:Date.now(),houseEdge:0.02,games:(r.miniGames??[]).filter(g=>g.owner===who.id).map(report)};}
/** Called only inside the shared wallet/room CAS. RNG is server-only and retries
 * remain speculative until one complete room+wallet+receipt+audit CAS commits. */
export function miniAction(r:Room,who:Identity,input:MiniInput,rng:(max:number)=>number=randomInt){
 const member=register(r,who);
 // The wager's stable ID survives concurrent CAS retries and response reordering.
 // Legacy starts used random IDs, so their acknowledged replay may have no retained result.
 if(checkFinanceRequest(r,who.id,input))return input.type==="start"?(r.miniGames??[]).find(g=>g.owner===who.id&&g.id===input.requestId)?.id??null:input.id;
 const before=member.wallet;let g:MiniGame;
 if(input.type==="start"){
  ensure(isWholeCasinoAmount(input.amount)&&input.amount>=100&&input.amount<=casinoLimits(r).gamesMaxBet,"Bet must be whole dollars within the games limit.");
  ensure(member.wallet>=input.amount,"Not enough money in your wallet.");
  ensure(!(r.miniGames??[]).some(g=>g.owner===who.id&&g.kind===input.game&&g.status==="active"),"Finish your current game first.",409);
  g={id:input.requestId,owner:who.id,kind:input.game,bet:input.amount,status:"active",revision:0,steps:0,payout:0,createdAt:Date.now(),num:98,den:100};
  member.wallet-=g.bet;
  // Retain every active session and the latest 30 terminal sessions per player.
  let retained=0;r.miniGames=[g,...(r.miniGames??[]).filter(x=>x.owner!==who.id||x.status==="active"||retained++<30)];
  if(g.kind==="plinko"){
   const path=Array.from({length:8},()=>rng(2)),slot=path.reduce((a,b)=>a+b,0);g.result={path,slot};
   // weights are half-integers. E[weight] = 355/256.
   g.num=PLINKO_WEIGHTS[slot]*2*98*256;g.den=2*100*355;settle(r,g,"won");
  }else if(g.kind==="dice"){
   ensure(Number.isInteger(input.target)&&input.target!>=2&&input.target!<=98,"Choose a target from 2 to 98.");
   ensure(input.direction==="over"||input.direction==="under","Choose over or under.");
   g.target=input.target;g.direction=input.direction;const roll=rng(100)+1;g.result={roll};const wins=g.direction==="over"?100-g.target!:g.target!-1;
   g.num=98;g.den=wins;settle(r,g,(g.direction==="over"?roll>g.target!:roll<g.target!)?"won":"lost");
  }else if(g.kind==="chicken"){chickenStep(r,g,rng);}
  else if(g.kind==="hilo"){g.card=rng(13)+2;g.cards=[g.card];}
  else if(g.kind==="mines"){
   ensure(Number.isInteger(input.mines)&&input.mines!>=1&&input.mines!<=10,"Choose 1 to 10 mines.");g.mines=input.mines;g.revealed=[];
   const cells=Array.from({length:25},(_,i)=>i);for(let i=24;i>0;i--){const j=rng(i+1);[cells[i],cells[j]]=[cells[j],cells[i]];}g.bombs=cells.slice(0,g.mines);
  }
 }else{
  g=(r.miniGames??[]).find(g=>g.id===input.id&&g.owner===who.id)!;ensure(g,"Game not found.",404);
  ensure(g.status==="active"&&g.revision===input.revision,"Game changed. Reload before acting.",409);
  if(input.type==="cashout"){ensure(g.steps>0,"Make one successful move before cashing out.");settle(r,g,"cashed");}
  else if(g.kind==="hilo"){
   ensure(input.choice==="high"||input.choice==="low","Choose higher or lower.");const old=g.card!,wins=input.choice==="high"?14-old:old-2;ensure(wins>0,"That direction cannot win.");
   const card=rng(13)+2;g.card=card;g.cards!.push(card);g.result={card};g.steps++;
   if(input.choice==="high"?card>old:card<old){fraction(g,13,wins);if(g.steps===6)settle(r,g,"won");}else settle(r,g,"lost");
  }else if(g.kind==="mines"){
   ensure(Number.isInteger(input.cell)&&input.cell!>=0&&input.cell!<25,"Choose a cell.");ensure(!g.revealed!.includes(input.cell!),"Cell already revealed.",409);
   if(g.bombs!.includes(input.cell!)){g.result={hit:input.cell};settle(r,g,"lost");}else{fraction(g,25-g.steps,25-g.mines!-g.steps);g.revealed!.push(input.cell!);g.steps++;if(g.steps===25-g.mines!)settle(r,g,"won");}
  }else if(g.kind==="chicken"){
   chickenStep(r,g,rng);
  }else ensure(false,"This game has already finished.",409);
  g.revision++;
 }
 audit(r,who,"minigame-"+input.type,g.id,{wallet:before},{requestId:input.requestId,kind:g.kind,bet:g.bet,status:g.status,steps:g.steps,revision:g.revision,payout:g.payout,wallet:member.wallet,result:g.result??null});
 recordFinanceRequest(r,who.id,input,"committed");
 return g.id;
}
