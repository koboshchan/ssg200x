import {mutate} from './store';
import {register} from './poker';
import {ensure} from './errors';
import {rouletteAction,type RouletteAction} from './roulette';
import type {Identity} from './types';
export async function rouletteMove(who:Identity,action:RouletteAction,round:number,requestId:string,requestAt:number){
 return (await mutate(r=>{
  register(r,who);const now=Date.now();ensure(now-requestAt>=-10_000&&now-requestAt<=120_000,'Request expired.',409);
  const receipt=r.receipts.find(x=>x.id===requestId);if(receipt){ensure(receipt.userId===who.id,'Invalid request.',409);return;}
  rouletteAction(r,who,action,round,requestId,now);
  r.receipts=[{id:requestId,userId:who.id,at:now},...r.receipts.filter(x=>x.at&&now-x.at<300_000)];
 })).room;
}
