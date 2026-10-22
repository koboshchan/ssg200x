import {randomUUID} from "node:crypto";
import {ensure} from "./errors";
import {activeSymbol} from "./symbol-registry";
import {requireQuote,liquidatable,settle,type Position} from "./finance";
import {openingFeeCents,positionFeeRates} from "../runtime/perp-fee-policy.mjs";
import {positionSlice,increasedEntry} from "../runtime/perp-adjustments.mjs";
import {validateTriggers} from "./position-triggers";
import {audit} from "./audit";
import {financeAuditSnapshot} from "./finance-audit";
import type {Room,Identity} from "./types";
type Adjustment={positionId:string;expectedRevision:number;requestId:string}&({type:"increase";margin:number}|{type:"partial-close";percentBps:number});
/** Executed inside the existing room CAS with request receipts in that same CAS.
 * Ownership and optimistic exposure revision are checked before pricing/mutation.
 * Requests never carry a price, leverage, fee, or another user's wallet. */
export function adjustPerp(r:Room,who:Identity,input:Adjustment,now=Date.now()){
 const m=r.members.find(m=>m.id===who.id),p=m?.positions?.find(p=>p.id===input.positionId);
 ensure(m&&p,"Position not found.",404);
 ensure(Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision===(p.revision??0),"Position changed. Review it before trying again.",409);
 ensure(activeSymbol(p.symbol,r),"Delisted positions can only be closed in full.",410);
 const mark=requireQuote(r,p.symbol,now);
 ensure(!liquidatable(p,mark),"Position has reached liquidation. Refresh before trying again.",409);
 const old={...p},oldWallet=m.wallet;
 ensure((p.revision??0)<Number.MAX_SAFE_INTEGER,"Position revision limit reached.",409);
 if(input.type==="increase"){
  const amount=input.margin,rate=positionFeeRates(p).openingFeePpm;
  ensure(Number.isSafeInteger(amount)&&amount>=100&&amount<=100_000_000,"Use $1–$1,000,000 per increase.");
  ensure(m.wallet>=amount,"Not enough cash.");
  const fee=openingFeeCents(amount,p.leverage,rate),added=amount-fee;
  const next:Position={...p,...positionFeeRates(p),margin:p.margin+added,collateral:(p.collateral??p.margin)+added,postedMargin:(p.postedMargin??p.margin)+amount,openingFee:(p.openingFee??0)+fee,entry:increasedEntry(p,added,mark),revision:(p.revision??0)+1};
  // Legacy fees were wallet-paid, not part of posted margin. Keep that model
  // rather than silently migrating its sunk fee into modern cost attribution.
  if(p.collateral===undefined){delete next.collateral;next.margin=p.margin+added;next.postedMargin=(p.postedMargin??p.margin)+added;}
  ensure(p.leverage<=(r.limits?.maxLeverage??200)&&next.postedMargin!<=100_000_000&&next.postedMargin!<=(r.limits?.maxTrade??1000000)*100&&next.margin<=100_000_000&&next.margin*p.leverage<=(r.limits?.maxTrade??1000000)*100&&amount<=(r.limits?.maxTrade??1000000)*100,"Increased position exceeds the host's trade limit.");
  ensure(Number.isSafeInteger(next.entry)&&next.entry>0&&!liquidatable(next,mark),"Increased position has insufficient equity for liquidation reserve.");
  ensure(!(p.takeProfit!=null&&(p.side==="long"?mark>=p.takeProfit:mark<=p.takeProfit))&&!(p.stopLoss!=null&&(p.side==="long"?mark<=p.stopLoss:mark>=p.stopLoss)),"A position trigger has already been reached. Refresh before increasing.",409);
  validateTriggers(next);
  Object.assign(p,next);m.wallet-=amount;r.house=(r.house??0)+fee;
  m.activity=[`Increased ${p.side} ${p.symbol} · ${(amount/100).toFixed(2)} posted · ${(fee/100).toFixed(2)} opening fee · position ${p.id}`,...(m.activity??[])].slice(0,40);
  audit(r,who,"finance-increase",p.id,{...financeAuditSnapshot(input.requestId,"Open",old,mark),wallet:oldWallet},{...financeAuditSnapshot(input.requestId,"Open",p,mark),wallet:m.wallet,addedMargin:added,addedOpeningFee:fee});
 }else{
  ensure(Number.isInteger(input.percentBps)&&input.percentBps>=1&&input.percentBps<=10000,"Choose more than 0% and at most 100%.");
  ensure(BigInt(p.margin)*BigInt(input.percentBps)>=10000n,"Selected portion is below one cent of margin. Increase the percentage.");
  const {slice,remainder}=positionSlice(p,input.percentBps);
  // A detached slice cannot remove its parent. Unique history IDs keep every
  // realization distinct, while the live position retains its stable ID.
  if(remainder.margin>0)slice.id=randomUUID();
  const index=m.positions!.indexOf(p);
  settle(r,m,slice,mark,"Manual",now);
  if(remainder.margin>0)m.positions![index]=remainder;
  const closed=m.closedPositions![0];
  audit(r,who,"finance-partial-close",p.id,{...financeAuditSnapshot(input.requestId,"Manual",old,mark),wallet:oldWallet},{...financeAuditSnapshot(input.requestId,"Manual",remainder,mark),exists:remainder.margin>0,closeId:closed.id,closedMargin:slice.margin,openingFee:slice.openingFee??0,closingFee:closed.closingFee??0,realizedPnl:closed.realizedPnl,wallet:m.wallet});
 }
}
