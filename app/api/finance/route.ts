import {openingFeeCents,roomFeeRates,closingFeeMode} from "../../../runtime/perp-fee-policy.mjs";
import {sellAllSpot} from "@/lib/spot-sell-all";
import {rouletteBetSchema as bet} from "@/lib/casino-schemas";
import {randomUUID} from "node:crypto";
import {z} from "zod";
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
const base={requestId:z.string().uuid(),requestAt:z.number().int()};
const money=z.number().int().min(100).max(100_000_000),symbol=z.string().regex(/^[A-Z][A-Z0-9.\-]{0,14}$/);
const triggerPrice=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const triggerMode=z.enum(["price","pnl"]);
const openTriggers={triggerInputMode:triggerMode.optional(),takeProfit:triggerPrice.optional(),stopLoss:triggerPrice.optional(),takeProfitPnl:triggerPrice.optional(),stopLossPnl:triggerPrice.optional()};
const editTriggers={triggerInputMode:triggerMode.optional(),takeProfit:triggerPrice.nullable().optional(),stopLoss:triggerPrice.nullable().optional(),takeProfitPnl:triggerPrice.nullable().optional(),stopLossPnl:triggerPrice.nullable().optional()};
const schema=z.discriminatedUnion("type",[
 z.object({...base,type:z.literal("sell-all-spot"),symbol}).strict(),
 z.object({...base,type:z.literal("redeem-legacy"),symbol}).strict(),
 z.object({...base,type:z.literal("spin"),bets:z.array(bet).min(1).max(20)}).strict(),
 z.object({...base,type:z.literal("spot"),symbol,side:z.enum(["buy","sell"]),amount:money}).strict(),
 z.object({...base,type:z.literal("open"),symbol,side:z.enum(["long","short"]),margin:money,leverage:z.number().int().min(1).max(200),expectedOpeningFeePpm:z.number().int().min(0).max(1000).optional(),expectedClosingFeePpm:z.number().int().min(0).max(1000000).optional(),expectedClosingFeeMode:z.enum(["notional","profit"]).optional(),expectedFeePpm:z.number().int().min(0).max(1000).optional(),...openTriggers}).strict(),
 z.object({...base,type:z.literal("triggers"),positionId:z.string().uuid(),...editTriggers}).strict(),
 z.object({...base,type:z.literal("close"),positionId:z.string().uuid()}).strict(),
]);
export const POST=(request:Request)=>endpoint(request,async who=>{
 await rateLimit("finance:"+who.id,40);const input=await parse(request,schema);
 const id=randomUUID();
 const {room}=await mutate(r=>{
 ensure(Date.now()-input.requestAt>=-10_000&&Date.now()-input.requestAt<=120_000,"Request expired. Try again.",409);
 const receipt=r.receipts.find(x=>x.id===input.requestId);if(receipt){ensure(receipt.userId===who.id,"Invalid request.",409);return;}
 if(input.type==="spin")ensure(false,"Instant spins are disabled. Use the shared roulette table.",410);
 else if(input.type==="redeem-legacy"){
  const result=redeemLegacyHolding(r,who,input.symbol);
  audit(r,who,"finance-legacy-redeem",input.symbol,{requestId:input.requestId,...result.old},{requestId:input.requestId,units:0,returned:result.returned,quote:result.quote,wallet:result.wallet});
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
 r.receipts=[{id:input.requestId,userId:who.id,at:Date.now()},...r.receipts.filter(x=>x.at&&Date.now()-x.at<300_000)];
 });return publicRoom(room,who);
});
