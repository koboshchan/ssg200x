import {idleRate,type IdleAnchor} from './roulette-physics';
import {settleAdvancements} from "./advancements";
import {casinoLimits,CASINO_LIMIT_MAX_CENTS} from "./casino-limits";
import {isWholeCasinoAmount} from "./casino-amount";
import {randomInt,randomUUID} from 'node:crypto';
import {ensure} from './errors';
import {payout} from './finance';
import {houseEdgeBps} from './house-edge';
import type {Bet} from './market-shared';
import type {Room,Identity} from './types';
import {ROULETTE_MS,ROULETTE_OPEN_MS,ROULETTE_SPIN_MS,ROULETTE_RESULT_MS,roulettePhase,ambientWheelRotation,type RouletteSpin} from './roulette-clock';
export {ROULETTE_MS,ROULETTE_OPEN_MS} from './roulette-clock';
export type RouletteWager={id:string;userId:string;bet:Bet;dead?:boolean;houseEdgeBps?:number;returned?:number};
export type RouletteState={round:number;started:number;anchor?:IdleAnchor;pending?:{id:string;lockedAt:number;target?:number;generatedAt?:number};spin?:RouletteSpin;settledBets?:RouletteWager[];bets:RouletteWager[];previousBets?:RouletteWager[];history:{round:number;number:number;at:number;winners?:{publicId:string;name:string;stake:number;returned:number}[]}[]};
// Private, persisted engine metadata never crosses the public serializer.
function publicBet(b:Bet):Bet{return {kind:b.kind,...(b.pick===undefined?{}:{pick:b.pick}),amount:b.amount};}
function returnedFor(w:RouletteWager,number:number,rng:(max:number)=>number){return w.dead===true?0:payout(w.bet,number,CASINO_LIMIT_MAX_CENTS,w.houseEdgeBps,rng);}
function safeLedger(value:number){ensure(Number.isSafeInteger(value),'Roulette exceeds safe ledger precision.',500);return value;}
function ledgerSum(...values:number[]){
 const result=values.reduce((sum,value)=>sum+BigInt(safeLedger(value)),0n);
 ensure(result>=-BigInt(Number.MAX_SAFE_INTEGER)&&result<=BigInt(Number.MAX_SAFE_INTEGER),'Roulette exceeds safe ledger precision.',500);
 return Number(result);
}
function repeatable(b:RouletteState,userId:string){
 // Forfeited historical placements never become payable through Last bet.
 return (b.previousBets||[]).filter(w=>w.userId===userId&&w.dead!==true);
}
type RRoom=Room&{roulette?:RouletteState};
export type RouletteAction={type:'rebet'}|{type:'bet';bet:Bet}|{type:'change';betId:string;bet:Bet}|{type:'cancel';betId:string};
export function initialAnchor(now:number):IdleAnchor{return {atMs:now,phase:.6,vel:idleRate(),slot:0,rel:0,r:.6};}
export function rouletteState(r:Room,now:number):RouletteState{return (r as RRoom).roulette??={round:1,started:now,bets:[],history:[],anchor:initialAnchor(now)};}
export function rouletteAssets(r:Room,userId?:string):number{return ((r as RRoom).roulette?.bets||[]).reduce((n,w)=>n+(!userId||w.userId===userId?w.bet.amount:0),0);}
/** Settlement shares the room CAS. Production supplies a post-lock solved spin;
 * the synchronous RNG path remains for existing engine fixtures/legacy rounds. */
export function rouletteTick(r:Room,now:number,rng:(max:number)=>number=randomInt,prepared?:RouletteSpin,payoutRng:(max:number)=>number=prepared?randomInt:rng):boolean{
 const existing=(r as RRoom).roulette;
 if(!existing){rouletteState(r,now);return true;}
 const b=existing;
 if(b.spin){
  if(now<b.spin.nextAt)return false;
  for(const member of r.members)settleAdvancements(member,b.settledBets??[],b.spin.number,b.round,b.spin.resultAt,r);
  b.round++;b.started=now;b.previousBets=b.settledBets??[];b.bets=[];delete b.settledBets;delete b.spin;return true;
 }
 if(!prepared&&now<b.started+ROULETTE_MS)return false;
 ensure(!b.pending||prepared,'Locked round requires solved physics.',500);
 const fromRotation=ambientWheelRotation(b.started,now,b.history[0]);
 const number=prepared?.number??rng(37);ensure(Number.isInteger(number)&&number>=0&&number<=36,'Invalid wheel result.',500);
 // Preflight the complete settlement before mutating wallets, house or wagers.
 // Realize stochastic cents once per wager, reuse for ledger and all history views.
 // Prepared spins forbid another wheel draw, not independent payout rounding.
 const realized=b.bets.map(w=>{ensure(r.members.some(m=>m.id===w.userId),'Missing wager owner.',500);return {w,returned:safeLedger(returnedFor(w,number,payoutRng))};});
 const settlements=r.members.map(m=>{
  const mine=realized.filter(x=>x.w.userId===m.id);
  const stake=mine.reduce((sum,x)=>ledgerSum(sum,x.w.bet.amount),0);
  const returned=mine.reduce((sum,x)=>ledgerSum(sum,x.returned),0);
  return {m,stake,returned,wallet:ledgerSum(m.wallet,returned),hasBets:mine.length>0};
 });
 const house=realized.reduce((sum,x)=>ledgerSum(sum,x.w.bet.amount,-x.returned),r.house??0);
 for(const x of realized)x.w.returned=x.returned;
 for(const {m,stake,returned,wallet,hasBets} of settlements){
  if(!hasBets)continue;
  m.wallet=wallet;
  m.spins=[{id:'roulette-'+b.round,number,stake,returned,at:now},...(m.spins||[])].slice(0,30);
 }
 r.house=house;
 const winners=r.members.flatMap(m=>{const spin=m.spins?.[0];return spin?.id==='roulette-'+b.round&&spin.returned>spin.stake?[{publicId:m.publicId,name:m.name,stake:spin.stake,returned:spin.returned}]:[];});
 b.history=[{round:b.round,number,at:now,winners},...b.history].slice(0,20);b.settledBets=b.bets;b.bets=[];b.spin=prepared??{round:b.round,number,fromRotation,startedAt:now,resultAt:now+ROULETTE_SPIN_MS,nextAt:now+ROULETTE_SPIN_MS+ROULETTE_RESULT_MS};delete b.pending;return true;
}
export function rouletteAction(r:Room,who:Identity,action:RouletteAction,round:number,id:string,now:number):void{
 const m=r.members.find(m=>m.id===who.id);ensure(m,'Account not found.',404);
 const b=rouletteState(r,now);ensure(round===b.round,'The roulette round changed. Refresh first.',409);
 ensure(!b.spin&&!b.pending&&now>=b.started&&now<b.started+ROULETTE_OPEN_MS,'Betting is locked.',409);
 if(action.type==='rebet'){
  ensure(!b.bets.some(w=>w.userId===who.id),'Clear your current bets before using Last bet.',409);
  const previous=repeatable(b,who.id);ensure(previous.length,'No bets from the previous round.');
  ensure(previous.every(w=>isWholeCasinoAmount(w.bet.amount)),'Last bet contains a fractional dollar. Choose new chips.');
  const stake=previous.reduce((n,w)=>ledgerSum(n,w.bet.amount),0);
  ensure(previous.length<=20&&stake<=casinoLimits(r).rouletteMaxTotal,'Total roulette bet cannot exceed the table limits.');
  for(const w of previous)payout(w.bet,0,CASINO_LIMIT_MAX_CENTS);
  ensure(m.wallet>=stake,'Not enough cash to repeat the last bet.');
  const edgeBps=houseEdgeBps(r),wallet=ledgerSum(m.wallet,-stake);
  m.wallet=wallet;b.bets.push(...previous.map(w=>({id:randomUUID(),userId:who.id,bet:publicBet(w.bet),houseEdgeBps:edgeBps})));return;
 }
 const old=action.type==='bet'?undefined:b.bets.find(w=>w.id===action.betId&&w.userId===who.id);
 if(action.type!=='bet')ensure(old,'Bet not found.',404);
 ensure(!old?.dead,'Historical forfeited bets cannot be changed.');
 if(action.type==='cancel'){m.wallet=ledgerSum(m.wallet,old!.bet.amount);b.bets=b.bets.filter(w=>w!==old);return;}
 ensure(isWholeCasinoAmount(action.bet.amount),'Bet must be whole dollars.');
 payout(action.bet,0,CASINO_LIMIT_MAX_CENTS); // Validate even losing selections before taking any chips.
 const mine=b.bets.filter(w=>w.userId===who.id),stake=mine.reduce((n,w)=>n+w.bet.amount,0)-(old?.bet.amount||0)+action.bet.amount;
 ensure(stake<=casinoLimits(r).rouletteMaxTotal,'Total roulette bet exceeds the current table limit.');ensure(old||mine.length<20,'Maximum 20 bets per round.');
 const diff=action.bet.amount-(old?.bet.amount||0);ensure(m.wallet>=diff,'Not enough cash.');
 const edgeBps=houseEdgeBps(r),wallet=ledgerSum(m.wallet,-diff);
 m.wallet=wallet;
 if(old){old.bet=publicBet(action.bet);old.houseEdgeBps=edgeBps;delete old.returned;}
 else b.bets.push({id,userId:who.id,bet:publicBet(action.bet),houseEdgeBps:edgeBps});
}
export function roulettePublic(r:Room,who:Identity,now=Date.now()){
 const b=(r as RRoom).roulette;
 // This view never initializes persisted state. The worker owns the initial clock.
 return b?{round:b.round,started:b.started,locksAt:b.started+ROULETTE_OPEN_MS,spinsAt:b.started+ROULETTE_MS,idleAnchor:b.anchor??initialAnchor(b.started),locked:!!b.spin||!!b.pending||now>=b.started+ROULETTE_OPEN_MS,phase:roulettePhase({locksAt:b.started+ROULETTE_OPEN_MS,spinsAt:b.started+ROULETTE_MS,spin:b.spin??null},now),spin:b.spin?{...(b.spin.physics?{physics:{...b.spin.physics,serverNow:now}}:{}),round:b.spin.round,number:b.spin.number,fromRotation:b.spin.fromRotation,startedAt:b.spin.startedAt,resultAt:b.spin.resultAt,nextAt:b.spin.nextAt}:null,lastBets:repeatable(b,who.id).map(w=>publicBet(w.bet)),history:b.history.filter(h=>!b.spin||h.round!==b.round||now>=b.spin.resultAt).map(h=>({round:h.round,number:h.number,at:h.at,...(h.winners?{winners:h.winners.map(w=>({publicId:w.publicId,name:w.name,stake:w.stake,returned:w.returned}))}:{})})),bets:(b.spin?b.settledBets??[]:b.bets).map(w=>{const m=r.members.find(m=>m.id===w.userId)!;return {id:w.id,publicId:m.publicId,name:m.name,isYou:w.userId===who.id,bet:publicBet(w.bet)};})}:null;
}
export type RoulettePublic=ReturnType<typeof roulettePublic>;
