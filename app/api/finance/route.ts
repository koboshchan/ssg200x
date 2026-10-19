import {randomUUID} from "node:crypto";
import {z} from "zod";
import {endpoint,parse} from "@/lib/api";
import {mutate,rateLimit} from "@/lib/store";
import {publicRoom} from "@/lib/public";
import {spot,openPosition,closePosition,requireQuote,SYMBOLS} from "@/lib/finance";
import {ensure} from "@/lib/errors";
import {editPositionTriggers} from "@/lib/position-triggers";
import {resolveTriggerInput} from "@/lib/trading-settings";
import {register} from "@/lib/poker";
import {audit} from "@/lib/audit";
const base={requestId:z.string().uuid(),requestAt:z.number().int()};
const money=z.number().int().min(100).max(100_000_000),symbol=z.enum(SYMBOLS);
const bet=z.object({kind:z.enum(["straight","red","black","odd","even","low","high","dozen","column"]),pick:z.number().int().min(0).max(36).optional(),amount:z.number().int().min(100).max(100_000)}).strict();
const triggerPrice=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const triggerMode=z.enum(["price","pnl"]);
const openTriggers={triggerInputMode:triggerMode.optional(),takeProfit:triggerPrice.optional(),stopLoss:triggerPrice.optional(),takeProfitPnl:triggerPrice.optional(),stopLossPnl:triggerPrice.optional()};
const editTriggers={triggerInputMode:triggerMode.optional(),takeProfit:triggerPrice.nullable().optional(),stopLoss:triggerPrice.nullable().optional(),takeProfitPnl:triggerPrice.nullable().optional(),stopLossPnl:triggerPrice.nullable().optional()};
const schema=z.discriminatedUnion("type",[
 z.object({...base,type:z.literal("spin"),bets:z.array(bet).min(1).max(20)}).strict(),
 z.object({...base,type:z.literal("spot"),symbol,side:z.enum(["buy","sell"]),amount:money}).strict(),
 z.object({...base,type:z.literal("open"),symbol,side:z.enum(["long","short"]),margin:money,leverage:z.number().int().min(1).max(200),...openTriggers}).strict(),
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
 else if(input.type==="spot")spot(r,who,input.symbol,input.side,input.amount);
 else if(input.type==="open"){
  const member=register(r,who),now=Date.now();
  const patch=resolveTriggerInput(member,{entry:requireQuote(r,input.symbol,now),margin:input.margin,leverage:input.leverage,side:input.side},input);
  openPosition(r,who,input.symbol,input.side,input.margin,input.leverage,id,now,{...(patch.takeProfit!=null?{takeProfit:patch.takeProfit}:{}),...(patch.stopLoss!=null?{stopLoss:patch.stopLoss}:{})});
  audit(r,who,"finance-open",id,{requestId:input.requestId,positionId:id,position:null},{requestId:input.requestId,positionId:id,position:{...member.positions!.find(p=>p.id===id)!}});
 }
 else if(input.type==="triggers"){
  const member=r.members.find(m=>m.id===who.id),position=member?.positions?.find(p=>p.id===input.positionId);
  ensure(member&&position,"Position not found.",404);
  const old={...position};
  editPositionTriggers(r,who,input.positionId,resolveTriggerInput(member,position,input));
  audit(r,who,"finance-triggers",input.positionId,{requestId:input.requestId,positionId:input.positionId,position:old},{requestId:input.requestId,positionId:input.positionId,position:{...position}});
 }
 else {
  const member=r.members.find(m=>m.id===who.id),position=member?.positions?.find(p=>p.id===input.positionId);
  ensure(member&&position,"Position not found.",404);
  const old={...position};closePosition(r,who,input.positionId);
  audit(r,who,"finance-close",input.positionId,{requestId:input.requestId,positionId:input.positionId,position:old},{requestId:input.requestId,positionId:input.positionId,position:{...member.closedPositions!.find(p=>p.id===input.positionId)!}});
 }
 r.receipts=[{id:input.requestId,userId:who.id,at:Date.now()},...r.receipts.filter(x=>x.at&&Date.now()-x.at<300_000)];
 });return publicRoom(room,who);
});
