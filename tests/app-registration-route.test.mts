import test,{mock} from "node:test";
import assert from "node:assert/strict";
import {AppError} from "../lib/errors";
mock.module("../lib/api.ts",{namedExports:{
 endpoint:async(_request:Request,handler:Function)=>{
  try{return Response.json(await handler({id:"nonadmin",admin:false}));}
  catch(error){return Response.json({error:error instanceof AppError?error.message:"Service unavailable. Try again."},{status:error instanceof AppError?error.status:503});}
 },
 parse:async(request:Request,schema:any)=>schema.parse(await request.json())
}});
mock.module("../lib/db.ts",{namedExports:{db:async()=>({})}});
mock.module("../lib/app-model.ts",{namedExports:{
 appIndexes:async()=>{},applications:()=>{},credentials:()=>{},grants:()=>{},transactions:()=>{},
 audit:()=>{},appTransaction:()=>{},links:()=>{},previews:()=>{},usage:()=>{},
 RetryAppTransaction:class extends Error{}
}});
const {POST}=await import("../app/api/developer/apps/[[...path]]/route");
test("nonadmin application registration preserves asynchronous forbidden denial",async()=>{
 const response=await POST(new Request("https://qa.invalid/api/developer/apps",{
  method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify({name:"Denied QA",description:"nonadmin test",website:"https://example.com"})
 }));
 assert.equal(response.status,403);
 assert.deepEqual(await response.json(),{error:"Only admins can create applications."});
});
