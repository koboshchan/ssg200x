import {z} from "zod";
import {endpoint,parse} from "@/lib/api";
import {ensure} from "@/lib/errors";
const schema=z.object({v:z.literal(1),publicId:z.string().regex(/^[a-f0-9]{16}$/),requestId:z.string().uuid(),requestAt:z.number().int(),confirm:z.literal(true)}).strict();
export async function POST(request:Request){return endpoint(request,async who=>{
 ensure(who.admin,"Administrator access required.",403);
 const payload=await parse(request,schema);
 const response=await fetch(`http://127.0.0.1:${Number(process.env.PORT||3000)}/internal-chat-reset`,{
  method:"POST",headers:{"content-type":"application/json","x-internal-live-secret":process.env.INTERNAL_LIVE_SECRET||""},
  body:JSON.stringify({actor:who.id,payload}),signal:AbortSignal.timeout(15000)
 });
 const result=await response.json();
 ensure(response.ok,result.error==="rate_limited"?"Too many resets. Try again in a minute.":"Chat reset couldn't finish. Retry the same request.",response.status===429?429:response.status===403?403:409);
 return {reset:true};
});}
