import {register,addLog} from "./poker";
import {ensure} from "./errors";
import type {Identity,Room} from "./types";
export function adjustBalance(r:Room,who:Identity,target:string,delta:number){
 ensure(who.admin,"Administrator access required.",403);
 register(r,who);
 const m=r.members.find(x=>x.publicId===target);ensure(m,"Account not found.",404);
 ensure(Number.isSafeInteger(delta)&&delta!==0&&Math.abs(delta)<=100_000_000,"Adjustment must be nonzero and at most $1,000,000.");
 ensure(m.wallet+delta>=0&&m.wallet+delta<=1_000_000_000,"Resulting cash balance must be between $0 and $10,000,000.");
 m.wallet+=delta;r.issuance=(r.issuance||0)+delta;m.adjustments=(m.adjustments||0)+delta;
 r.audit=[{admin:who.id,target:m.id,delta,at:Date.now()},...(r.audit||[])].slice(0,1000);
 addLog(r,"Host adjusted "+m.name+"'s cash by "+(delta/100).toFixed(2));
}
