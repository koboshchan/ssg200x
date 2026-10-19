import {randomInt,randomUUID} from "node:crypto";
import {z} from "zod";
import {endpoint,parse} from "@/lib/api";
import {mutate,rateLimit} from "@/lib/store";
import {publicRoom} from "@/lib/public";
import {spin,spot,openPosition,closePosition,SYMBOLS} from "@/lib/finance";
import {ensure} from "@/lib/errors";
const base={requestId:z.string().uuid(),requestAt:z.number().int()};
const money=z.number().int().min(100).max(100_000_000),symbol=z.enum(SYMBOLS);
const bet=z.object({kind:z.enum(["straight","red","black","odd","even","low","high","dozen","column"]),pick:z.number().int().min(0).max(36).optional(),amount:z.number().int().min(100).max(100_000)}).strict();
const schema=z.discriminatedUnion("type",[
 z.object({...base,type:z.literal("spin"),bets:z.array(bet).min(1).max(20)}).strict(),
 z.object({...base,type:z.literal("spot"),symbol,side:z.enum(["buy","sell"]),amount:money}).strict(),
 z.object({...base,type:z.literal("open"),symbol,side:z.enum(["long","short"]),margin:money,leverage:z.number().int().min(1).max(200)}).strict(),
 z.object({...base,type:z.literal("close"),positionId:z.string().uuid()}).strict(),
]);
export const POST=(request:Request)=>endpoint(request,async who=>{
 await rateLimit("finance:"+who.id,40);const input=await parse(request,schema);
 const n=randomInt(37),id=randomUUID();
 const {room}=await mutate(r=>{
 ensure(Date.now()-input.requestAt>=-10_000&&Date.now()-input.requestAt<=120_000,"Request expired. Try again.",409);
 const receipt=r.receipts.find(x=>x.id===input.requestId);if(receipt){ensure(receipt.userId===who.id,"Invalid request.",409);return;}
 if(input.type==="spin")spin(r,who,input.bets,n,id);
 else if(input.type==="spot")spot(r,who,input.symbol,input.side,input.amount);
 else if(input.type==="open")openPosition(r,who,input.symbol,input.side,input.margin,input.leverage,id);
 else closePosition(r,who,input.positionId);
 r.receipts=[{id:input.requestId,userId:who.id,at:Date.now()},...r.receipts.filter(x=>x.at&&Date.now()-x.at<300_000)];
 });return publicRoom(room,who);
});
