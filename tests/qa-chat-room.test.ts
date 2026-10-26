import test from "node:test";
import assert from "node:assert/strict";
import {chatRoomIds,isolatedQaChatRoomEnabled} from "../runtime/chat-room-policy.mjs";
import {ChatClient} from "../lib/chat-client";
// @ts-expect-error Node server runtime
import {createChatService} from "../runtime/chat-service.mjs";
// @ts-expect-error Node server runtime
import {createPokerChatService} from "../runtime/poker-chat-service.mjs";
// @ts-expect-error Node server runtime
import {emitRoomState} from "../runtime/room-state.mjs";
const pk=(host:string)=>"pk_test_"+Buffer.from(host+"$").toString("base64");
const env={SSG_QA_CHAT_ROOM:"1",SSG_ISOLATED_QA:"1",QA_PROTECTED_COLLECTIONS:"candles",CLERK_PUBLISHABLE_KEY:pk("qa.clerk.accounts.dev"),CLERK_SECRET_KEY:"sk_test_"+"a".repeat(32)};
const rejected:Record<string,string|undefined>[]=[{},...["SSG_QA_CHAT_ROOM","SSG_ISOLATED_QA","QA_PROTECTED_COLLECTIONS","CLERK_SECRET_KEY","CLERK_PUBLISHABLE_KEY"].map(k=>({...env,[k]:undefined})),
 {...env,SSG_QA_CHAT_ROOM:"true"},{...env,SSG_ISOLATED_QA:"0"},{...env,QA_PROTECTED_COLLECTIONS:"other"},
 {...env,CLERK_SECRET_KEY:"sk_live_"+"a".repeat(32)},{...env,CLERK_SECRET_KEY:"sk_test_bad!"},
 {...env,CLERK_PUBLISHABLE_KEY:env.CLERK_PUBLISHABLE_KEY.replace("pk_test_","pk_live_")},
 {...env,CLERK_PUBLISHABLE_KEY:"pk_test_invalid"},{...env,CLERK_PUBLISHABLE_KEY:pk("qa.clerk.accounts.dev.evil")},
 {...env,CLERK_PUBLISHABLE_KEY:pk("production.example")}];
test("QA room is absent unless explicit protected isolation and strict DEV credentials all validate",()=>{
 for(const config of rejected){
  assert.equal(isolatedQaChatRoomEnabled(config),false);
  assert.deepEqual(chatRoomIds(config),["main","poker-02","poker-03"]);
  assert.throws(()=>createChatService({}, {roomId:"qa-isolated",env:config}),/Invalid chat room/);
 }
 assert.equal(isolatedQaChatRoomEnabled(env),true);
 assert.equal(isolatedQaChatRoomEnabled({...env,SSG_QA_EMAIL_AUTH:"0"}),true);
 assert.deepEqual(chatRoomIds(env),["main","poker-02","poker-03","qa-isolated"]);
});
test("wire capability is validated at runtime, omitted for production, and strips unsolicited values",()=>{
 for(const config of [env,...rejected]){
  let emitted:any;
  const socket={data:{},emit:(_event:string,value:any)=>{emitted=value;}};
  emitRoomState(socket,{maintenance:{blocked:false},room:{version:1,qaChatRoom:"untrusted"}},true,config);
  assert.equal(emitted.data.qaChatRoom,config===env?"qa-isolated":undefined);
  assert.equal(Object.hasOwn(emitted.data,"qaChatRoom"),config===env);
 }
});
test("dispatcher rejects QA room before persistence when disabled and always enforces ordinary membership when enabled",async()=>{
 const room={_id:"main",version:1,members:[{id:"owner",approved:true}]},touched:string[]=[];
 const db={collection:(name:string)=>({
  createIndex:async()=>{},updateOne:async()=>({matchedCount:1}),
  findOne:async()=>{touched.push(name);assert.equal(name,"rooms");return room;}
 })};
 for(const config of [{},env]){
  const service=createPokerChatService(db,{env:config});
  await service.ready;
  touched.length=0;
  await assert.rejects(service.handle("outsider","state",{v:1,chatRoom:"qa-isolated"}),config===env?/forbidden/:/malformed/);
  assert.deepEqual(touched,config===env?["rooms"]:[]);
  await assert.rejects(service.handle("owner","state",{v:1,chatRoom:"qa-isolated",room:"main"}),/malformed/);
 }
});
test("client rejects QA room absent a server-announced explicit capability",()=>{
 assert.throws(()=>new ChatClient("ordinary",async()=>({}),{} as any,Date.now,undefined,undefined,"qa-isolated"),/Invalid chat room/);
 const client=new ChatClient("ordinary",async()=>({}),{} as any,Date.now,undefined,undefined,"qa-isolated",{isolatedQaChatRoom:true});
 client.close();
 assert.throws(()=>new ChatClient("ordinary",async()=>({}),{} as any,Date.now,undefined,undefined,"arbitrary",{isolatedQaChatRoom:true}),/Invalid chat room/);
});
