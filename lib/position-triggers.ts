import {ensure} from "./errors";
import {closePosition,liquidate,liqPrice} from "./finance";
import type {Position} from "./finance";
import type {Room,Identity} from "./types";
export type PositionTriggers={takeProfit?:number;stopLoss?:number};
export type TriggerPatch={takeProfit?:number|null;stopLoss?:number|null};
export function validateTriggers(p:Position & PositionTriggers){
 const long=p.side==="long",liq=liqPrice(p);
 for(const [name,price] of [["Take-profit",p.takeProfit],["Stop-loss",p.stopLoss]] as const){
  if(price===undefined)continue;
  ensure(Number.isSafeInteger(price)&&price>0,`${name} must be a positive price with at most six decimals.`);
 }
 if(p.takeProfit!==undefined)ensure(long?p.takeProfit>p.entry:p.takeProfit<p.entry,"Take-profit must be beyond entry in the profit direction.");
 if(p.stopLoss!==undefined){
  ensure(long?p.stopLoss<p.entry:p.stopLoss>p.entry,"Stop-loss must be beyond entry in the loss direction.");
  ensure(long?p.stopLoss>liq:p.stopLoss<liq,"Stop-loss must be before the liquidation price.");
 }
}
/** Mutates only the requesting member's persisted position. Null removes a trigger. */
export function editPositionTriggers(r:Room,who:Identity,id:string,patch:TriggerPatch){
 const p=r.members.find(m=>m.id===who.id)?.positions?.find(p=>p.id===id) as (Position & PositionTriggers)|undefined;
 ensure(p,"Position not found.",404);
 const next={...p};
 for(const key of ["takeProfit","stopLoss"] as const){if(patch[key]===null)delete next[key];else if(patch[key]!==undefined)next[key]=patch[key];}
 validateTriggers(next);
 for(const key of ["takeProfit","stopLoss"] as const){if(next[key]===undefined)delete p[key];else p[key]=next[key];}
}
/** Call inside the quote CAS transaction, even when there are no connected clients. */
export function settleTriggers(r:Room,now=Date.now()){
 // A gap beyond liquidation forfeits the margin, even if a stop was crossed first.
 liquidate(r,now);
 for(const m of r.members)for(const p of [...(m.positions||[])] as (Position & PositionTriggers)[]){
  const q=r.quotes?.[p.symbol];
  if(!q||!Number.isSafeInteger(q.micro)||q.micro<=0||q.at>now||now-q.at>10_000)continue;
  const reason=p.stopLoss!==undefined&&(p.side==="long"?q.micro<=p.stopLoss:q.micro>=p.stopLoss)?"Stop-loss":p.takeProfit!==undefined&&(p.side==="long"?q.micro>=p.takeProfit:q.micro<=p.takeProfit)?"Take-profit":null;
  if(!reason)continue;
  const who={id:m.id,name:m.name,email:m.email,admin:false};
  closePosition(r,who,p.id,now,reason==="Take-profit"?"TP":"SL");
  m.activity![0]=`${reason} · ${m.activity![0]} · filled at $${(q.micro/1e6).toFixed(6)}`;
 }
}
