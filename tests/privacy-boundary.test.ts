import test from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register} from "../lib/poker";
import {publicRoom} from "../lib/public";
import {transferView} from "../lib/transfers";
// @ts-expect-error Runtime-only JavaScript guard.
import {sessionGuard} from "../runtime/chat-session.mjs";
const alice={id:"user_aliceSecret",name:"Alice",email:"alice-private@example.test",admin:false};
const bob={id:"user_bobSecret",name:"Bob",email:"bob-private@example.test",admin:false};
const host={id:"user_hostSecret",name:"Host",email:"host-private@example.test",admin:true};
test("room wire redacts account emails and Clerk IDs for players AND administrators",()=>{
 const room=freshRoom();for(const who of [alice,bob,host])register(room,who);
 for(const viewer of [alice,host]){
  const wire=JSON.stringify(publicRoom(room,viewer));
  for(const who of [alice,bob,host]){assert.ok(!wire.includes(who.id));assert.ok(!wire.includes(who.email));}
  assert.ok(!wire.includes('"email"'));
 }
});
test("another user's private portfolio stays out of player snapshots",()=>{
 const room=freshRoom();register(room,alice);const member=register(room,bob);
 member.positions=[{id:"bob-private-position",symbol:"BTC",side:"long",margin:1000,entry:1000000,leverage:2,openedAt:0,maintenance:0} as never];
 const wire=JSON.stringify(publicRoom(room,alice));
 assert.ok(!wire.includes("bob-private-position"));assert.deepEqual(publicRoom(room,alice).adminUsers,[]);
});
test("transfer history view rejects unrelated users and omits internal party IDs",()=>{
 const record={_id:"receipt",sender:alice.id,recipient:bob.id,senderName:alice.name,recipientName:bob.name,amount:100,note:"",at:0,fingerprint:"internal",senderBefore:100,senderAfter:0,recipientBefore:0,recipientAfter:100};
 assert.throws(()=>transferView(record,{...host,admin:false}),/Transfer unavailable/);
 const wire=JSON.stringify(transferView(record,alice));assert.ok(!wire.includes(alice.id));assert.ok(!wire.includes(bob.id));assert.ok(!wire.includes("fingerprint"));
});
const user=(admin:boolean)=>({firstName:"Alice",username:null,passwordEnabled:false,primaryEmailAddressId:"email",emailAddresses:[{id:"email",emailAddress:alice.email,verification:{status:"verified"}}],externalAccounts:[{provider:"google",emailAddress:alice.email}],privateMetadata:{admin}});
test("live snapshot session check refreshes revoked administrator privilege",async()=>{
 let now=100000,admin=true,active=true;
 const clerk={sessions:{getSession:async()=>({status:active?"active":"revoked",userId:alice.id})},users:{getUser:async()=>user(admin)}};
 const check=sessionGuard(clerk,{now:()=>now});
 const socket={connected:true,data:{expires:999999,sessionId:"session",identity:{...alice,admin:true}}};
 await check(socket);assert.equal(socket.data.identity.admin,true);
 admin=false;now+=10001;await check(socket);assert.equal(socket.data.identity.admin,false);
 active=false;now+=10001;await assert.rejects(check(socket),/session/);
});
test("expired and wrong-user socket sessions are rejected",async()=>{
 const check=sessionGuard({sessions:{getSession:async()=>({status:"active",userId:bob.id})}},{now:()=>100});
 await assert.rejects(check({connected:true,data:{expires:99,sessionId:"s",identity:alice}}),/session/);
 await assert.rejects(check({connected:true,data:{expires:999,sessionId:"s",identity:alice}}),/session/);
});
