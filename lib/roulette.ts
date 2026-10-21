import {settleAdvancements} from "./advancements";
import {casinoLimits,CASINO_LIMIT_MAX_CENTS} from "./casino-limits";
import {ROULETTE_CHIPS} from "./roulette-chips";
import {audit} from "./audit";
import {isWholeCasinoAmount} from "./casino-amount";
import {randomInt,randomUUID} from 'node:crypto';
import {ensure} from './errors';
import {payout} from './finance';
import type {Bet} from './market-shared';
import type {Room,Identity} from './types';
import {ROULETTE_MS,ROULETTE_OPEN_MS,ROULETTE_SPIN_MS,ROULETTE_RESULT_MS,roulettePhase,ambientWheelRotation,type RouletteSpin} from './roulette-clock';
export {ROULETTE_MS,ROULETTE_OPEN_MS} from './roulette-clock';
export type RouletteWager={id:string;userId:string;bet:Bet;dead?:boolean};
export type RouletteState={round:number;started:number;spin?:RouletteSpin;settledBets?:RouletteWager[];bets:RouletteWager[];previousBets?:RouletteWager[];history:{round:number;number:number;at:number;winners?:{publicId:string;name:string;stake:number;returned:number}[]}[]};
// Private, persisted engine metadata never crosses the public serializer.
const chipAmounts=new Set<number>(ROULETTE_CHIPS.map(chip=>chip.value*100));
function publicBet(b:Bet):Bet{return {kind:b.kind,...(b.pick===undefined?{}:{pick:b.pick}),amount:b.amount};}
function returnedFor(w:RouletteWager,number:number){return w.dead===true?0:payout(w.bet,number,CASINO_LIMIT_MAX_CENTS);}
function repeatable(b:RouletteState,userId:string){
 // Keep the original individual chip multiset, never infer provenance from an aggregate.
 // Unknown historical custom totals and forfeited placements cannot become payable chips.
 return (b.previousBets||[]).filter(w=>w.userId===userId&&w.dead!==true&&chipAmounts.has(w.bet.amount));
}
type RRoom=Room&{roulette?:RouletteState};
export type RouletteAction={type:'rebet'}|{type:'bet';bet:Bet}|{type:'change';betId:string;bet:Bet}|{type:'cancel';betId:string};
export function rouletteState(r:Room,now:number):RouletteState{return (r as RRoom).roulette??={round:1,started:now,bets:[],history:[]};}
export function rouletteAssets(r:Room,userId?:string):number{return ((r as RRoom).roulette?.bets||[]).reduce((n,w)=>n+(!userId||w.userId===userId?w.bet.amount:0),0);}
/** Every transition shares the existing room CAS. Result is chosen once at spin start,
 * never during betting. Hold the settled round through animation and result pause. */
export function rouletteTick(r:Room,now:number,rng:(max:number)=>number=randomInt):boolean{
 const existing=(r as RRoom).roulette;
 if(!existing){rouletteState(r,now);return true;}
 const b=existing;
 if(b.spin){
  if(now<b.spin.nextAt)return false;
  for(const member of r.members)settleAdvancements(member,b.settledBets??[],b.spin.number,b.round,b.spin.resultAt,r);
  b.round++;b.started=now;b.previousBets=b.settledBets??[];b.bets=[];delete b.settledBets;delete b.spin;return true;
 }
 if(now<b.started+ROULETTE_MS)return false;
 const fromRotation=ambientWheelRotation(b.started,now,b.history[0]);
 const number=rng(37);ensure(Number.isInteger(number)&&number>=0&&number<=36,'Invalid wheel result.',500);
 for(const w of b.bets){const m=r.members.find(m=>m.id===w.userId);ensure(m,'Missing wager owner.',500);const returned=returnedFor(w,number);m.wallet+=returned;r.house=(r.house??0)+w.bet.amount-returned;}
 for(const m of r.members){const wagers=b.bets.filter(w=>w.userId===m.id);if(!wagers.length)continue;const stake=wagers.reduce((n,w)=>n+w.bet.amount,0),returned=wagers.reduce((n,w)=>n+returnedFor(w,number),0);m.spins=[{id:'roulette-'+b.round,number,stake,returned,at:now},...(m.spins||[])].slice(0,30);}
 const winners=r.members.flatMap(m=>{const spin=m.spins?.[0];return spin?.id==='roulette-'+b.round&&spin.returned>spin.stake?[{publicId:m.publicId,name:m.name,stake:spin.stake,returned:spin.returned}]:[];});
 b.history=[{round:b.round,number,at:now,winners},...b.history].slice(0,20);b.settledBets=b.bets;b.bets=[];b.spin={round:b.round,number,fromRotation,startedAt:now,resultAt:now+ROULETTE_SPIN_MS,nextAt:now+ROULETTE_SPIN_MS+ROULETTE_RESULT_MS};return true;
}
export function rouletteAction(r:Room,who:Identity,action:RouletteAction,round:number,id:string,now:number):void{
 const m=r.members.find(m=>m.id===who.id);ensure(m,'Account not found.',404);
 const b=rouletteState(r,now);ensure(round===b.round,'The roulette round changed. Refresh first.',409);
 ensure(!b.spin&&now>=b.started&&now<b.started+ROULETTE_OPEN_MS,'Betting is locked.',409);
 if(action.type==='rebet'){
  ensure(!b.bets.some(w=>w.userId===who.id),'Clear your current bets before using Last bet.',409);
  const previous=repeatable(b,who.id);ensure(previous.length,'No bets from the previous round.');
  ensure(previous.every(w=>isWholeCasinoAmount(w.bet.amount)),'Last bet contains a fractional dollar. Choose new chips.');
  const stake=previous.reduce((n,w)=>n+w.bet.amount,0);
  ensure(previous.length<=20&&stake<=casinoLimits(r).rouletteMaxTotal,'Total roulette bet cannot exceed the table limits.');
  for(const w of previous)payout(w.bet,0,CASINO_LIMIT_MAX_CENTS);
  ensure(m.wallet>=stake,'Not enough cash to repeat the last bet.');
  m.wallet-=stake;b.bets.push(...previous.map(w=>({id:randomUUID(),userId:who.id,bet:publicBet(w.bet)})));return;
 }
 const old=action.type==='bet'?undefined:b.bets.find(w=>w.id===action.betId&&w.userId===who.id);
 if(action.type!=='bet')ensure(old,'Bet not found.',404);
 if(action.type==='cancel'){m.wallet+=old!.bet.amount;b.bets=b.bets.filter(w=>w!==old);return;}
 ensure(isWholeCasinoAmount(action.bet.amount),'Bet must be whole dollars.');
 payout(action.bet,0,CASINO_LIMIT_MAX_CENTS); // Validate even losing selections before taking any chips.
 const mine=b.bets.filter(w=>w.userId===who.id),stake=mine.reduce((n,w)=>n+w.bet.amount,0)-(old?.bet.amount||0)+action.bet.amount;
 ensure(stake<=casinoLimits(r).rouletteMaxTotal,'Total roulette bet exceeds the current table limit.');ensure(old||mine.length<20,'Maximum 20 bets per round.');
 const diff=action.bet.amount-(old?.bet.amount||0);ensure(m.wallet>=diff,'Not enough cash.');m.wallet-=diff;
 const dead=!chipAmounts.has(action.bet.amount);
 if(old){old.bet=publicBet(action.bet);if(dead)old.dead=true;else delete old.dead;}
 else b.bets.push({id,userId:who.id,bet:publicBet(action.bet),...(dead?{dead:true}:{})});
 if(!chipAmounts.has(action.bet.amount))audit(r,who,"roulette-dead-placement",who.id,null,{
  round,requestId:id,wagerId:old?.id??id,bet:publicBet(action.bet),dead:true,action:action.type,at:now,
 });
}
export function roulettePublic(r:Room,who:Identity,now=Date.now()){
 const b=(r as RRoom).roulette;
 // This view never initializes persisted state. The worker owns the initial clock.
 return b?{round:b.round,started:b.started,locksAt:b.started+ROULETTE_OPEN_MS,spinsAt:b.started+ROULETTE_MS,locked:!!b.spin||now>=b.started+ROULETTE_OPEN_MS,phase:roulettePhase({locksAt:b.started+ROULETTE_OPEN_MS,spinsAt:b.started+ROULETTE_MS,spin:b.spin??null},now),spin:b.spin?{round:b.spin.round,number:b.spin.number,fromRotation:b.spin.fromRotation,startedAt:b.spin.startedAt,resultAt:b.spin.resultAt,nextAt:b.spin.nextAt}:null,lastBets:repeatable(b,who.id).map(w=>publicBet(w.bet)),history:b.history.filter(h=>!b.spin||h.round!==b.round||now>=b.spin.resultAt).map(h=>({round:h.round,number:h.number,at:h.at,...(h.winners?{winners:h.winners.map(w=>({publicId:w.publicId,name:w.name,stake:w.stake,returned:w.returned}))}:{})})),bets:(b.spin?b.settledBets??[]:b.bets).map(w=>{const m=r.members.find(m=>m.id===w.userId)!;return {id:w.id,publicId:m.publicId,name:m.name,isYou:w.userId===who.id,bet:publicBet(w.bet)};})}:null;
}
export type RoulettePublic=ReturnType<typeof roulettePublic>;
