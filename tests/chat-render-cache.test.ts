import {test} from "node:test";
import assert from "node:assert/strict";
import {ChatClient,RENDER_CAP,RENDER_TRIM,OPEN_CACHE_MAX} from "../lib/chat-client";
import {createIdentity,newEpochKey,sealMessage,openMessage,type WireMessage} from "../lib/chat-crypto";

const store:any={getIdentity:async()=>undefined};
async function setup(){
 const a=await createIdentity("a",0),key=await newEpochKey();
 const mk=async(i:number,text="m"+i):Promise<WireMessage>=>({...await sealMessage(a.identity,"a",{revision:1,epoch:"e",id:"id"+i,ts:1000+i},text,key),senderUserId:"a",senderSignPublic:a.identity.signPublic,serverTs:i,cursor:i});
 let calls=0;
 const c:any=new ChatClient("a",async()=>({}),store,Date.now,(m,k)=>{calls++;return openMessage(m,k);});
 c.identity=a.identity;c.keys.set("e",key);c.pins.set("a",{deviceId:a.identity.deviceId,signPublic:a.identity.signPublic,dhPublic:a.identity.dhPublic,known:[a.identity.signPublic]});
 const add=(m:WireMessage)=>c.raw.set(m.epoch+":a:"+m.id,m);
 return {c,mk,add,calls:()=>calls,key};
}

test("unrelated rerenders and duplicate delivery do not repeat crypto",async()=>{
 const t=await setup();const m=await t.mk(1);t.add(m);t.add({...m});
 await t.c.render();await t.c.render();await t.c.render();
 assert.equal(t.calls(),1);assert.equal(t.c.getSnapshot().messages[0].text,"m1");
});
test("concurrent renders share in-flight work",async()=>{
 const t=await setup();for(let i=0;i<5;i++)t.add(await t.mk(i));
 await Promise.all([t.c.render(),t.c.render(),t.c.render()]);assert.equal(t.calls(),5);
});
test("tampered content sharing an id cannot reuse cached plaintext",async()=>{
 const t=await setup();const m=await t.mk(1);t.add(m);await t.c.render();
 t.add({...m,ciphertext:m.ciphertext.slice(0,-4)+(m.ciphertext.endsWith("AAAA")?"BBBB":"AAAA")});await t.c.render();
 const x=t.c.getSnapshot().messages[0];assert.equal(x.text,null);assert.notEqual(x.status,"ok");
});
test("renders cap at 500 then trim to 400 while cache stays bounded",async()=>{
 const t=await setup();for(let i=0;i<RENDER_CAP;i++)t.add(await t.mk(i));
 await t.c.render();assert.equal(t.c.getSnapshot().messages.length,RENDER_CAP);
 t.add(await t.mk(RENDER_CAP));await t.c.render();
 const ms=t.c.getSnapshot().messages;assert.equal(ms.length,RENDER_TRIM);assert.equal(ms.at(-1).text,"m"+RENDER_CAP);
 assert.equal(t.c.raw.size,RENDER_CAP+1);assert.ok(t.c.opened.size<=OPEN_CACHE_MAX);
});
test("session reset and trust clear cached plaintext; new key object is not served stale",async()=>{
 const t=await setup();t.add(await t.mk(1));await t.c.render();assert.equal(t.c.opened.size,1);
 const other=await newEpochKey();t.c.keys.set("e",other);await t.c.render();
 assert.equal(t.c.getSnapshot().messages[0].status,"undecryptable");
 t.c.clearSession();assert.equal(t.c.opened.size,0);assert.equal(t.c.getSnapshot().messages.length,0);
});
