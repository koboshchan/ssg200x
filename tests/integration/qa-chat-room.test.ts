import {test,after} from "node:test";
import assert from "node:assert/strict";
import {MongoClient} from "mongodb";
import {createIdentity,signText,makeWrap,newEpochKey,sealMessage,openMessage,openWrap} from "../../lib/chat-crypto";
// @ts-expect-error Node server runtime
import {createPokerChatService} from "../../runtime/poker-chat-service.mjs";
// @ts-expect-error Node server runtime
import {registerData} from "../../runtime/chat-protocol.mjs";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw Error("Isolated database required");
const client=new MongoClient(process.env.MONGODB_URI!),db=client.db(process.env.MONGODB_DB+"_qa_chat");
after(async()=>{await db.dropDatabase();await client.close();});
test("QA room uses ordinary signed claim/self-wrap/share/send crypto flow without touching active original epochs",async()=>{
 const env={SSG_QA_CHAT_ROOM:"1",SSG_ISOLATED_QA:"1",QA_PROTECTED_COLLECTIONS:"candles",CLERK_PUBLISHABLE_KEY:"pk_test_"+Buffer.from("qa.clerk.accounts.dev$").toString("base64"),CLERK_SECRET_KEY:"sk_test_"+"a".repeat(32)};
 const service=createPokerChatService(db,{env});await service.ready;
 await db.collection("rooms").insertOne({_id:"main" as never,version:1,members:[{id:"alice",approved:true},{id:"bob",approved:true}]});
 const originals=["main","poker-02","poker-03"].map(_id=>({_id:_id as never,epoch:crypto.randomUUID(),status:"active",revision:38}));
 await db.collection("chat_states").insertMany(originals);
 const call=(user:string,event:string,p:any)=>service.handle(user,event,{...p,chatRoom:"qa-isolated"});
 const a=(await createIdentity("alice",0)).identity,b=(await createIdentity("bob",0)).identity;
 for(const [user,identity] of [["alice",a],["bob",b]] as const){
  await call(user,"register",{v:1,deviceId:identity.deviceId,dhPublic:identity.dhPublic,signPublic:identity.signPublic,signature:await signText(identity.signPrivate,registerData(user,identity))});
 }
 await assert.rejects(call("outsider","state",{v:1}),/forbidden/);
 let state=await call("alice","state",{v:1});
 state=await call("alice","claim",{v:1,revision:state.revision,epoch:state.epoch,deviceId:a.deviceId});
 const key=await newEpochKey(),fields={room:"qa-isolated",revision:state.revision,epoch:state.epoch};
 await call("alice","wrap",await makeWrap(a,"alice",{...fields,toUserId:"alice",toDeviceId:a.deviceId},a.dhPublic,key));
 await assert.rejects(call("bob","claim",{v:1,revision:state.revision,epoch:state.epoch,deviceId:b.deviceId}),/waiting/);
 const share=await makeWrap(a,"alice",{...fields,toUserId:"bob",toDeviceId:b.deviceId},b.dhPublic,key);
 await call("alice","wrap",share);
 const bstate=await call("bob","state",{v:1}),grant=bstate.wraps.find((w:any)=>w.epoch===state.epoch);
 const recovered=await openWrap(b,"bob",grant,a,"qa-isolated");
 for(const [user,identity,k,other] of [["alice",a,key,"bob"],["bob",b,recovered,"alice"]] as const){
  const payload=await sealMessage(identity,user,{...fields,id:crypto.randomUUID(),ts:Date.now()},"normal encrypted "+user,k);
  const sent=await call(user,"send",payload);
  const page=await call(other,"history",{v:1,epoch:state.epoch,deviceId:other==="alice"?a.deviceId:b.deviceId});
  assert.ok(page.messages.some((m:any)=>m.id===payload.id));
  assert.deepEqual(await openMessage(sent.message,other==="alice"?key:recovered),{ok:true,text:"normal encrypted "+user});
 }
 for(const original of originals)assert.deepEqual(await db.collection("chat_states").findOne({_id:original._id}),original);
});
