import {auth,currentUser} from "@clerk/nextjs/server";
import {NextResponse} from "next/server";
import {ZodError,type ZodType} from "zod";
import {AppError,ensure} from "./errors";
import {rateLimit} from "./store";
import {verifiedGoogleEmail} from "./google-identity";
import {siteMaintenance} from "./site-maintenance";
import type {Identity} from "./types";
export const configured=()=>Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_")&&process.env.CLERK_SECRET_KEY);
export async function endpoint(request:Request,handler:(who:Identity)=>Promise<unknown>) {
 try {
  ensure(configured(),"Clerk setup required.",503);
  const {userId}=await auth(); ensure(userId,"Sign in with Google.",401);
  if(request.method!=="GET") {
   ensure(process.env.APP_ORIGIN&&request.headers.get("origin")===new URL(process.env.APP_ORIGIN).origin,"Request origin not allowed.",403);
   ensure(request.headers.get("content-type")?.split(";")[0]==="application/json","Use application/json.",415);
  }
  const user=await currentUser();
  const email=verifiedGoogleEmail(user);
  ensure(user&&email,"A verified Google-only account is required.",403);
  const who:Identity={id:userId,name:user.firstName||user.username||"Player",email,admin:user.publicMetadata.role==="admin"};
  await rateLimit(userId);
  if(!who.admin&&new URL(request.url).pathname!=="/api/maintenance")ensure(!(await siteMaintenance(false)).blocked,"Under maintenance",503);
  return NextResponse.json(await handler(who),{headers:{"Cache-Control":"no-store"}});
 }catch(e) {
  const status=e instanceof AppError?e.status:e instanceof ZodError||e instanceof SyntaxError?400:503;
  return NextResponse.json({error:e instanceof AppError?e.message:status===400?"Invalid request.":"Service unavailable. Try again."},{status,headers:{"Cache-Control":"no-store",...(status===429?{"Retry-After":"60"}:{})}});
 }
}
export async function parse<T>(request:Request,schema:ZodType<T>) {
 const reader=request.body?.getReader();ensure(reader,"Missing body.");
 let text="",bytes=0;const decoder=new TextDecoder();
 try {while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;ensure(bytes<=2048,"Request too large.",413);text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();}
 finally{await reader.cancel();}
 return schema.parse(JSON.parse(text));
}
