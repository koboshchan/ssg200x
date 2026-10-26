// Fixture replacement for lib/api. The real route handlers import this; identity comes from the demo cookie only.
import type {ZodType} from "zod";
import type {Identity} from "@/lib/types";
export const configured=true;
export const FIXTURE_USERS:Record<string,Identity>={
 alice:{id:"alice",name:"Alice",email:"alice@example.test",admin:false} as Identity,
 bob:{id:"bob",name:"Bob",email:"bob@example.test",admin:false} as Identity,
};
export async function endpoint(request:Request,handler:(who:Identity)=>Promise<unknown>){
 const cookie=request.headers.get("cookie")||"";const m=/(?:^|; )gc_user=(alice|bob)(?:;|$)/.exec(cookie);
 const who=m?FIXTURE_USERS[m[1]]:null;
 if(!who)return Response.json({error:"Fixture account required."},{status:401});
 try{return Response.json(await handler(who),{headers:{"Cache-Control":"no-store"}});}
 catch(e:any){const status=typeof e?.status==="number"?e.status:e?.name==="ZodError"?400:500;
  return Response.json({error:e?.name==="ZodError"?"Invalid request.":(e?.message||"Failed")},{status,headers:{"Cache-Control":"no-store"}});}
}
export async function parse<T>(request:Request,schema:ZodType<T>,maxBytes=2048){
 const text=await request.text();if(text.length>maxBytes*8)throw Object.assign(new Error("Request too large"),{status:413});
 return schema.parse(JSON.parse(text));
}
