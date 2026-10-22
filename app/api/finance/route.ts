import {closeAllPerps} from "@/lib/perps-close-all";
import {financeSchema as schema} from "@/lib/finance-input";
import {checkFinanceRequest,recordFinanceRequest} from "@/lib/finance-requests";
import {openingFeeCents,roomFeeRates,closingFeeMode} from "../../../runtime/perp-fee-policy.mjs";
import {sellAllSpot} from "@/lib/spot-sell-all";
import {randomUUID} from "node:crypto";
import {endpoint,parse} from "@/lib/api";
import {mutate,rateLimit} from "@/lib/store";
import {freshPublicRoom as publicRoom} from "@/lib/public";
import {spot,openPosition,closePosition,requireQuote,redeemLegacyHolding,legacyQuote,SYMBOLS} from "@/lib/finance";
import {ensure} from "@/lib/errors";
import {editPositionTriggers} from "@/lib/position-triggers";
import {resolveTriggerInput} from "@/lib/trading-settings";
import {register} from "@/lib/poker";
import {audit} from "@/lib/audit";
import {financeAuditSnapshot} from "@/lib/finance-audit";
export const POST=(request:Request)=>endpoint(request,async who=>{
 await rateLimit("finance:"+who.id,40);const input=await parse(request,schema);
 const id=randomUUID();
 const {room}=await mutate(r=>{
 if(checkFinanceRequest(r,who.id,input))return;
 if(input.type==="spin")ensure(false,"Instant spins are disabled. Use the shared roulette table.",410);
 else if(input.type==="redeem-legacy"){
  const result=redeemLegacyHolding(r,who,input.symbol);
  audit(r,who,"finance-legacy-redeem",input.symbol,{requestId:input.requestId,...result.old},{requestId:input.requestId,units:0,returned:result.returned,quote:result.quote,wallet:result.wallet});
 }
 else if(input.type==="close-all"){
  const result=closeAllPerps(r,who,input.positionIds,input.requestId);
  recordFinanceRequest(r,who.id,input,"committed");
  r.financeReceipts![0].closeAll=result;return;
 }
 else if(input.type==="sell-all-spot")sellAllSpot(r,who,input.symbol);
 else if(input.type==="spot")spot(r,who,input.symbol,input.side,input.amount);
 else if(input.type==="open"){
  const rates=roomFeeRates(r);
  ensure((input.expectedOpeningFeePpm??input.expectedFeePpm??0)===rates.openingFeePpm&&(input.expectedClosingFeePpm??input.expectedFeePpm??0)===rates.closingFeePpm&&(input.expectedClosingFeeMode??"notional")===closingFeeMode(r),"Trading fee changed. Review the current fee and try again.",409);
  const member=register(r,who),now=Date.now();
  const patch=resolveTriggerInput(member,{entry:requireQuote(r,input.symbol,now),margin:input.margin-openingFeeCents(input.margin,input.leverage,rates.openingFeePpm),leverage:input.leverage,side:input.side},input);
  openPosition(r,who,input.symbol,input.side,input.margin,input.leverage,id,now,{...(patch.takeProfit!=null?{takeProfit:patch.takeProfit}:{}),...(patch.stopLoss!=null?{stopLoss:patch.stopLoss}:{})});
  const opened=member.positions!.find(p=>p.id===id)!;
  const snapshot=financeAuditSnapshot(input.requestId,"Open",opened,opened.entry);
  audit(r,who,"finance-open",id,{...snapshot,trigger:{takeProfit:null,stopLoss:null},exists:false},{...snapshot,exists:true});
 }
 else if(input.type==="triggers"){
  const member=r.members.find(m=>m.id===who.id),position=member?.positions?.find(p=>p.id===input.positionId);
  ensure(member&&position,"Position not found.",404);
  const old={...position};
  editPositionTriggers(r,who,input.positionId,resolveTriggerInput(member,position,input));
  const mark=r.quotes?.[position.symbol]?.micro??null;
  audit(r,who,"finance-triggers",input.positionId,financeAuditSnapshot(input.requestId,"Triggers",old,mark),financeAuditSnapshot(input.requestId,"Triggers",position,mark));
 }
 else {
  const member=r.members.find(m=>m.id===who.id),position=member?.positions?.find(p=>p.id===input.positionId);
  ensure(member&&position,"Position not found.",404);
  const old={...position},legacyValuation=legacyQuote(r,position.symbol);closePosition(r,who,input.positionId);
  const closed=member.closedPositions!.find(p=>p.id===input.positionId)!;
  audit(r,who,"finance-close",input.positionId,{...financeAuditSnapshot(input.requestId,"Manual",old,closed.exit),exists:true},{...financeAuditSnapshot(input.requestId,closed.reason==="Liq"?"Liq":"Manual",old,closed.exit),exists:false,...(legacyValuation?{legacyValuation}:{}),openingFee:closed.openingFee,closingFee:closed.closingFee,assessedClosingFee:closed.assessedClosingFee,waivedClosingFee:closed.waivedClosingFee,realizedPnl:closed.realizedPnl,closedAt:closed.closedAt});
 }
 recordFinanceRequest(r,who.id,input,"committed");
 });return publicRoom(room,who);
});
