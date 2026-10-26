import {test} from "node:test";
import assert from "node:assert/strict";
import {ChatClient} from "../lib/chat-client";
import {createIdentity,newEpochKey,sealMessage,openMessage,makeWrap,openWrap} from "../lib/chat-crypto";
const store:any={getIdentity:async()=>undefined};
const mk=(room:string)=>new ChatClient("a",async()=>({}),store,Date.now,openMessage,undefined,room);
const RAW="game-ddz-amber fox lake";
test("client accepts raw spaced DDZ rooms and legacy ids, rejects bad spacing",()=>{
 for(const ok of [RAW,"game-ddz-abc defgh ijklmnop","game-ddz-ABC123_x-y","game-poker-01","game-roulette-01"])assert.doesNotThrow(()=>mk(ok),ok);
 for(const bad of ["game-ddz-amber  fox lake","game-ddz-amber fox","game-ddz-amber fox lake ","game-ddz- amber fox lake","game-ddz-ab fox lake","game-ddz-Amber fox lake","game-ddz-amber fox lake extra","game-ddz-amber\tfox lake","game-ddz-amber fox lake\n","game-pool-a b"])assert.throws(()=>mk(bad),/Invalid chat room/,bad);
});
test("hyphen legacy id and spaced raw code are distinct rooms (no normalization)",async()=>{
 const a=await createIdentity("a",0),key=await newEpochKey();
 const m=await sealMessage(a.identity,"a",{room:RAW,revision:1,epoch:"e",id:"i1",ts:1},"hi",key);
 const ok=await openMessage({...m,senderUserId:"a",senderSignPublic:a.identity.signPublic} as any,key);
 assert.deepEqual(ok,{ok:true,text:"hi"});
 assert.equal(m.room,RAW);assert.notEqual(m.room,"game-ddz-amber-fox-lake");
 const bad=await openMessage({...m,room:"game-ddz-amber-fox-lake",senderUserId:"a",senderSignPublic:a.identity.signPublic} as any,key);
 assert.equal(bad.ok,false);
});
test("key share wrap for a raw DDZ room opens only in that room",async()=>{
 const a=await createIdentity("a",0),b=await createIdentity("b",0),key=await newEpochKey();
 const w=await makeWrap(a.identity,"a",{room:RAW,revision:1,epoch:"e",toUserId:"b",toDeviceId:b.identity.deviceId},b.identity.dhPublic,key);
 const sender={signPublic:a.identity.signPublic,dhPublic:a.identity.dhPublic};
 await openWrap(b.identity,"b",{...w,senderUserId:"a"} as any,sender,RAW);
 await assert.rejects(openWrap(b.identity,"b",{...w,senderUserId:"a"} as any,sender,"game-ddz-amber-fox-lake"));
});
