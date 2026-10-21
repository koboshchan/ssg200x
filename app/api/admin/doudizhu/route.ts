import {endpoint,parse} from "@/lib/api";
import {ensure} from "@/lib/errors";
import {readRoom} from "@/lib/db";
import {mutate,rateLimit} from "@/lib/store";
import {adminDoudizhuSnapshot,changeDoudizhuMaxBeansPerDollar,doudizhuBeansSchema} from "@/lib/admin-doudizhu";
export const GET=(request:Request)=>endpoint(request,async who=>{
 ensure(who.admin===true,"Administrator access required.",403);
 return adminDoudizhuSnapshot(await readRoom(),who);
});
export const POST=(request:Request)=>endpoint(request,async who=>{
 ensure(who.admin===true,"Administrator access required.",403);
 await rateLimit("admin-doudizhu:"+who.id,20);
 const input=await parse(request,doudizhuBeansSchema);
 const {room}=await mutate(room=>changeDoudizhuMaxBeansPerDollar(room,who,input));
 return adminDoudizhuSnapshot(room,who);
});
