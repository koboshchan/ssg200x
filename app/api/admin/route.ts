import {z} from "zod";
import {endpoint,parse} from "@/lib/api";
import {mutate,rateLimit} from "@/lib/store";
import {freshPublicRoom as publicRoom} from "@/lib/public";
import {setPerpFee,adjustBalance,setMaintenance,setLiquidation,setLimits,setMemberAccess} from "@/lib/admin";
import {audit} from "@/lib/audit";
import {ensure} from "@/lib/errors";
const stamp={requestId:z.string().uuid(),requestAt:z.number().int()};
const schema=z.union([z.object({...stamp,type:z.literal("perp-fee"),percent:z.number().min(0).max(0.1)}).strict(),z.object({...stamp,type:z.literal("member-access"),publicId:z.string().regex(/^[a-f0-9]{16}$/),allowed:z.boolean()}).strict(),z.object({...stamp,type:z.literal("site-maintenance"),enabled:z.boolean()}).strict(),z.object({...stamp,type:z.literal("limits"),maxTrade:z.number().min(1).max(1000000),maxLeverage:z.number().int().min(1).max(200)}).strict(),z.object({...stamp,type:z.literal("maintenance"),percent:z.number().min(0).max(20)}).strict(),z.object({...stamp,type:z.literal("liquidation"),publicId:z.string().regex(/^[a-f0-9]{16}$/),positionId:z.string().uuid(),price:z.number().positive().max(10_000_000)}).strict(),z.object({type:z.literal("balance"),publicId:z.string().regex(/^[a-f0-9]{16}$/),delta:z.number().int().min(-100_000_000).max(100_000_000).refine(n=>n!==0),requestId:z.string().uuid(),requestAt:z.number().int()}).strict()]);
export async function POST(request:Request){return endpoint(request,async who=>{
 ensure(who.admin,"Administrator access required.",403);await rateLimit("admin:"+who.id,30);
 const input=await parse(request,schema);
 const {room}=await mutate(r=>{
 ensure(Date.now()-input.requestAt>=-10_000&&Date.now()-input.requestAt<=120_000,"Request expired. Try again.",409);
 const repeated=r.receipts.find(x=>x.id===input.requestId);if(repeated){ensure(repeated.userId===who.id,"Invalid request.",409);return;}
 if(input.type==="member-access")setMemberAccess(r,who,input.publicId,input.allowed);
 else if(input.type==="site-maintenance"){audit(r,who,"site-maintenance","global",r.siteMaintenance===true,input.enabled);r.siteMaintenance=input.enabled;}
 else if(input.type==="balance")adjustBalance(r,who,input.publicId,input.delta);
 else if(input.type==="perp-fee")setPerpFee(r,who,input.percent);
 else if(input.type==="maintenance")setMaintenance(r,who,input.percent);
 else if(input.type==="limits")setLimits(r,who,input.maxTrade,input.maxLeverage);
 else setLiquidation(r,who,input.publicId,input.positionId,input.price);
 r.receipts=[{id:input.requestId,userId:who.id,at:Date.now()},...r.receipts.filter(x=>x.at&&Date.now()-x.at<300_000)];
 });return publicRoom(room,who);
});}
