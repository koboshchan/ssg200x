import {z} from "zod";
import {endpoint,parse} from "@/lib/api";
import {approve,mutate,rateLimit} from "@/lib/store";
import {approvalSchema} from "@/lib/schemas";
import {publicRoom} from "@/lib/public";
import {adjustBalance,setMaintenance,setLiquidation} from "@/lib/admin";
import {ensure} from "@/lib/errors";
const stamp={requestId:z.string().uuid(),requestAt:z.number().int()};
const schema=z.union([approvalSchema,z.object({...stamp,type:z.literal("maintenance"),percent:z.number().min(0).max(20)}).strict(),z.object({...stamp,type:z.literal("liquidation"),publicId:z.string().regex(/^[a-f0-9]{16}$/),positionId:z.string().uuid(),price:z.number().positive().max(10_000_000)}).strict(),z.object({type:z.literal("balance"),publicId:z.string().regex(/^[a-f0-9]{16}$/),delta:z.number().int().min(-100_000_000).max(100_000_000).refine(n=>n!==0),requestId:z.string().uuid(),requestAt:z.number().int()}).strict()]);
export async function POST(request:Request){return endpoint(request,async who=>{
 ensure(who.admin,"Administrator access required.",403);await rateLimit("admin:"+who.id,30);
 const input=await parse(request,schema);
 if(!("type" in input))return publicRoom(await approve(who,input.publicId,input.approved),who);
 const {room}=await mutate(r=>{
 ensure(Date.now()-input.requestAt>=-10_000&&Date.now()-input.requestAt<=120_000,"Request expired. Try again.",409);
 const repeated=r.receipts.find(x=>x.id===input.requestId);if(repeated){ensure(repeated.userId===who.id,"Invalid request.",409);return;}
 if(input.type==="balance")adjustBalance(r,who,input.publicId,input.delta);
 else if(input.type==="maintenance")setMaintenance(r,who,input.percent);
 else setLiquidation(r,who,input.publicId,input.positionId,input.price);
 r.receipts=[{id:input.requestId,userId:who.id,at:Date.now()},...r.receipts.filter(x=>x.at&&Date.now()-x.at<300_000)];
 });return publicRoom(room,who);
});}
