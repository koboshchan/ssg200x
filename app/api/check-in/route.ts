import {z} from "zod";
import {endpoint,parse} from "@/lib/api";
import {mutate} from "@/lib/store";
import {register} from "@/lib/poker";
import {claimCheckIn,checkInView,markCheckInBanner} from "@/lib/check-in";
export const dynamic="force-dynamic";
const schema=z.object({type:z.enum(["banner","claim"])}).strict();
export const POST=(request:Request)=>endpoint(request,async who=>{
 const input=await parse(request,schema);
 const {result}=await mutate(room=>{
  register(room,who);const member=room.members.find(m=>m.id===who.id)!,now=Date.now();
  if(input.type==="claim")return {...claimCheckIn(room,member,now),show:false};
  const show=markCheckInBanner(member,now);return {...checkInView(member,now),show};
 });return result;
});
