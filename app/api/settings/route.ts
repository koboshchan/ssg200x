import {hideFromLeaderboard,setLeaderboardPrivacy} from "@/lib/privacy-settings";
import {ensure} from "@/lib/errors";
import {z} from "zod";
import {endpoint,parse} from "@/lib/api";
import {mutate,rateLimit,visit} from "@/lib/store";
import {freshPublicRoom as publicRoom} from "@/lib/public";
import {setTradingSettings,triggerInputMode,skipCloseConfirmation,setCloseConfirmation} from "@/lib/trading-settings";
const schema=z.object({triggerInputMode:z.enum(["price","pnl"]).optional(),hideFromLeaderboard:z.boolean().optional(),skipCloseConfirmation:z.boolean().optional(),requestAt:z.number().int().optional(),requestId:z.string().uuid().optional()}).strict().refine(input=>input.triggerInputMode!==undefined||input.hideFromLeaderboard!==undefined||input.skipCloseConfirmation!==undefined,"Choose a setting to update.");
export const GET=(request:Request)=>endpoint(request,async who=>{
 const room=await visit(who);
 const member=room.members.find(m=>m.id===who.id)!;
 return {triggerInputMode:triggerInputMode(member),hideFromLeaderboard:hideFromLeaderboard(member),skipCloseConfirmation:skipCloseConfirmation(member)};
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
  if(input.skipCloseConfirmation!==undefined)setCloseConfirmation(r,who,input.skipCloseConfirmation);
  if(input.triggerInputMode!==undefined)setTradingSettings(r,who,input.triggerInputMode);
  if(input.hideFromLeaderboard!==undefined)setLeaderboardPrivacy(r,who,input.hideFromLeaderboard);
  if(input.requestId)r.receipts=[{id:input.requestId,userId:who.id,at:now},...r.receipts.filter(x=>x.at&&now-x.at<300_000)];
 });
 return publicRoom(room,who);
});
