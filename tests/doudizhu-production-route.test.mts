import {test,mock} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {freshRoom,register,assertRoom} from "../lib/poker";
import {applyDoudizhu} from "../lib/doudizhu";
import {AppError} from "../lib/errors";
import {ZodError} from "zod";
process.env.NODE_ENV="production";
const users=Array.from({length:3},(_,i)=>({id:"route-"+i,name:"Player",email:"test"+i+"@invalid.test",admin:false}));
let room=freshRoom();users.forEach(u=>register(room,u));
const now=Date.now();
function action(i:number,input:Record<string,unknown>){applyDoudizhu(room,users[i],{type:"ready",requestId:randomUUID(),requestAt:now,version:room.doudizhu?.[0]?.version,...input} as never,now);}
action(0,{type:"create"});const code=room.doudizhu![0].code;
action(1,{type:"join",code});action(2,{type:"join",code});
for(let i=0;i<3;i++)action(i,{type:"ready"});action(0,{type:"bid",bid:3});
let authIdentity:typeof users[number]|null=users[0],mutations=0;
mock.module("../lib/api.ts",{namedExports:{
 endpoint:async(_request:Request,handler:(who:typeof users[number])=>Promise<unknown>)=>{
 if(!authIdentity)return Response.json({error:"Unauthorized"},{status:401});
 try{return Response.json(await handler(authIdentity));}catch(e){return Response.json({error:e instanceof Error?e.message:"Error"},{status:e instanceof AppError?e.status:e instanceof ZodError?400:503});}
 },
 parse:async(request:Request,schema:{parse(x:unknown):unknown})=>schema.parse(await request.json())
}});
mock.module("../lib/store.ts",{namedExports:{
 visit:async()=>structuredClone(room),register,
 mutate:async(fn:(r:typeof room)=>void)=>{const next=structuredClone(room);fn(next);assertRoom(next);room=next;mutations++;return {room};}
}});
const {POST}=await import("../app/api/doudizhu/route");
function post(body:Record<string,unknown>){return POST(new Request("https://test.invalid/api/doudizhu",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({requestId:randomUUID(),requestAt:Date.now(),version:room.doudizhu![0].version,...body})}));}
test("actual production POST rejects malicious bot actions before mutation, auth mocked only at boundary",async()=>{
 const before=structuredClone(room),count=mutations;
 for(const type of ["auto","autoplay","bot","simulate"])assert.equal((await post({type})).status,400);
 for(const key of ["auto","autoplay","bot","simulate"])assert.equal((await post({type:"play",cards:[room.doudizhu![0].players[0].hand[0]],[key]:true})).status,400);
 assert.equal(mutations,count);assert.deepEqual(room,before);
});
test("actual production POST rejects active leave with no wallet or escrow changes",async()=>{
 const before=structuredClone(room);
 assert.equal((await post({type:"leave"})).status,409);assert.deepEqual(room,before);
});
test("actual production POST requires identity even for malformed bot requests",async()=>{
 authIdentity=null;assert.equal((await post({type:"auto"})).status,401);authIdentity=users[0];
});
