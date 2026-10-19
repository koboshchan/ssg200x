import {z} from "zod";
import {endpoint,parse} from "@/lib/api";
import {mutate,rateLimit,visit} from "@/lib/store";
import {publicRoom} from "@/lib/public";
import {setTradingSettings,triggerInputMode} from "@/lib/trading-settings";
const schema=z.object({triggerInputMode:z.enum(["price","pnl"]),requestAt:z.number().int().optional()}).strict();
export const GET=(request:Request)=>endpoint(request,async who=>{
 const room=await visit(who);
 return {triggerInputMode:triggerInputMode(room.members.find(m=>m.id===who.id)!)};
});
export const POST=(request:Request)=>endpoint(request,async who=>{
 await rateLimit("settings:"+who.id,30);
 const input=await parse(request,schema);
 const {room}=await mutate(r=>setTradingSettings(r,who,input.triggerInputMode));
 return publicRoom(room,who);
});
