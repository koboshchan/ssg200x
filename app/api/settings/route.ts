import {ensure} from "@/lib/errors";
import {z} from "zod";
import {endpoint,parse} from "@/lib/api";
import {mutate,rateLimit,visit} from "@/lib/store";
import {freshPublicRoom as publicRoom} from "@/lib/public";
import {setTradingSettings,triggerInputMode} from "@/lib/trading-settings";
const schema=z.object({triggerInputMode:z.enum(["price","pnl"]),requestAt:z.number().int().optional(),requestId:z.string().uuid().optional()}).strict();
export const GET=(request:Request)=>endpoint(request,async who=>{
 const room=await visit(who);
 return {triggerInputMode:triggerInputMode(room.members.find(m=>m.id===who.id)!)};
});
export const POST=(request:Request)=>endpoint(request,async who=>{
 await rateLimit("settings:"+who.id,30);
 const input=await parse(request,schema);
 const {room}=await mutate(r=>{
  const now=Date.now();
  if(input.requestAt!==undefined)ensure(now-input.requestAt>=-10_000&&now-input.requestAt<=120_000,"Request expired. Try again.",409);
  if(input.requestId){
   const receipt=r.receipts.find(x=>x.id===input.requestId);
   if(receipt){ensure(receipt.userId===who.id,"Invalid request.",409);return;}
  }
  setTradingSettings(r,who,input.triggerInputMode);
  if(input.requestId)r.receipts=[{id:input.requestId,userId:who.id,at:now},...r.receipts.filter(x=>x.at&&now-x.at<300_000)];
 });
 return publicRoom(room,who);
});
