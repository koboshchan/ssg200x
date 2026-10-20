import {mutate} from './store';
import {register} from './poker';
import {ensure} from './errors';
import {rouletteAction,rouletteTick,ROULETTE_MS,type RouletteAction} from './roulette';
import type {Identity} from './types';
import {readRoom} from './db';
import type {RouletteState} from './roulette';
export async function tickRoulette(){
 const r=await readRoom(),b=(r as typeof r&{roulette?:RouletteState}).roulette;
 if(!b||Date.now()>=(b.spin?.nextAt??b.started+ROULETTE_MS))await mutate(r=>rouletteTick(r,Date.now()));
}

export async function rouletteMove(who:Identity,action:RouletteAction,round:number,requestId:string,requestAt:number){
 return (await mutate(r=>{
  register(r,who);const now=Date.now();ensure(now-requestAt>=-10_000&&now-requestAt<=120_000,'Request expired.',409);
  const receipt=r.receipts.find(x=>x.id===requestId);if(receipt){ensure(receipt.userId===who.id,'Invalid request.',409);return;}
  rouletteAction(r,who,action,round,requestId,now);
  r.receipts=[{id:requestId,userId:who.id,at:now},...r.receipts.filter(x=>x.at&&now-x.at<300_000)];
 })).room;
}
