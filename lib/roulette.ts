import {randomInt,randomUUID} from 'node:crypto';
import {ensure} from './errors';
import {payout} from './finance';
import type {Bet} from './market-shared';
import type {Room,Identity} from './types';
export const ROULETTE_MS=60_000,ROULETTE_OPEN_MS=55_000;
export type RouletteWager={id:string;userId:string;bet:Bet};
export type RouletteState={round:number;started:number;bets:RouletteWager[];previousBets?:RouletteWager[];history:{round:number;number:number;at:number}[]};
type RRoom=Room&{roulette?:RouletteState};
export type RouletteAction={type:'rebet'}|{type:'bet';bet:Bet}|{type:'change';betId:string;bet:Bet}|{type:'cancel';betId:string};
export function rouletteState(r:Room,now:number):RouletteState{return (r as RRoom).roulette??={round:1,started:now,bets:[],history:[]};}
export function rouletteAssets(r:Room,userId?:string):number{return ((r as RRoom).roulette?.bets||[]).reduce((n,w)=>n+(!userId||w.userId===userId?w.bet.amount:0),0);}
/** Settlement and starting the next round share the room CAS commit. No future result is stored. */
export function rouletteTick(r:Room,now:number,rng:(max:number)=>number=randomInt):boolean{
 const b=rouletteState(r,now);if(now<b.started+ROULETTE_MS)return false;
 const number=rng(37);ensure(Number.isInteger(number)&&number>=0&&number<=36,'Invalid wheel result.',500);
 for(const w of b.bets){const m=r.members.find(m=>m.id===w.userId);ensure(m,'Missing wager owner.',500);const returned=payout(w.bet,number);m.wallet+=returned;r.house=(r.house??0)+w.bet.amount-returned;}
 for(const m of r.members){const wagers=b.bets.filter(w=>w.userId===m.id);if(!wagers.length)continue;const stake=wagers.reduce((n,w)=>n+w.bet.amount,0),returned=wagers.reduce((n,w)=>n+payout(w.bet,number),0);m.spins=[{id:'roulette-'+b.round,number,stake,returned,at:now},...(m.spins||[])].slice(0,30);}
 b.history=[{round:b.round,number,at:now},...b.history].slice(0,20);b.round++;b.started=now;b.previousBets=b.bets;b.bets=[];return true;
}
export function rouletteAction(r:Room,who:Identity,action:RouletteAction,round:number,id:string,now:number):void{
 const m=r.members.find(m=>m.id===who.id);ensure(m,'Account not found.',404);
 const b=rouletteState(r,now);ensure(round===b.round,'The roulette round changed. Refresh first.',409);
 ensure(now>=b.started&&now<b.started+ROULETTE_OPEN_MS,'Betting is locked.',409);
 if(action.type==='rebet'){
  ensure(!b.bets.some(w=>w.userId===who.id),'Clear your current bets before using Last bet.',409);
  const previous=(b.previousBets||[]).filter(w=>w.userId===who.id);ensure(previous.length,'No bets from the previous round.');
  const stake=previous.reduce((n,w)=>n+w.bet.amount,0);ensure(m.wallet>=stake,'Not enough cash to repeat the last bet.');
  m.wallet-=stake;b.bets.push(...previous.map(w=>({id:randomUUID(),userId:who.id,bet:{...w.bet}})));return;
 }
 const old=action.type==='bet'?undefined:b.bets.find(w=>w.id===action.betId&&w.userId===who.id);
 if(action.type!=='bet')ensure(old,'Bet not found.',404);
 if(action.type==='cancel'){m.wallet+=old!.bet.amount;b.bets=b.bets.filter(w=>w!==old);return;}
 payout(action.bet,0); // Validate even losing selections before taking any chips.
 const mine=b.bets.filter(w=>w.userId===who.id),stake=mine.reduce((n,w)=>n+w.bet.amount,0)-(old?.bet.amount||0)+action.bet.amount;
 ensure(stake<=100_000,'Total roulette bet cannot exceed $1,000.');ensure(old||mine.length<20,'Maximum 20 bets per round.');
 const diff=action.bet.amount-(old?.bet.amount||0);ensure(m.wallet>=diff,'Not enough cash.');m.wallet-=diff;
 if(old)old.bet={...action.bet};else b.bets.push({id,userId:who.id,bet:{...action.bet}});
}
export function roulettePublic(r:Room,who:Identity,now=Date.now()){
 const b=(r as RRoom).roulette;
 // This view never initializes persisted state. The worker owns the initial clock.
 return b?{round:b.round,started:b.started,locksAt:b.started+ROULETTE_OPEN_MS,spinsAt:b.started+ROULETTE_MS,locked:now>=b.started+ROULETTE_OPEN_MS,lastBets:(b.previousBets||[]).filter(w=>w.userId===who.id).map(w=>({...w.bet})),history:b.history,bets:b.bets.map(w=>{const m=r.members.find(m=>m.id===w.userId)!;return {id:w.id,publicId:m.publicId,name:m.name,isYou:w.userId===who.id,bet:{...w.bet}};})}:null;
}
export type RoulettePublic=ReturnType<typeof roulettePublic>;
