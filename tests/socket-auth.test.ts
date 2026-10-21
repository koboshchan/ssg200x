import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {Server} from "socket.io";
import {io} from "socket.io-client";
import {EventEmitter} from "node:events";
import {attachSocketAuth,attachSocketAuthClient} from "../runtime/socket-auth.mjs";
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
test("real socket renews repeatedly past its initial deadline without losing transport or state",async()=>{
 const http=createServer(),server=new Server(http,{transports:["websocket"],pingInterval:50,pingTimeout:1000});
 let connections=0,renewals=0,disconnects=0,revoked=false;
 server.on("connection",s=>{
  connections++;s.data={identity:{id:"alice"},sessionId:"session",expires:Date.now()+1500};
  attachSocketAuth(s,{refreshLead:300,retryMs:100,verify:async token=>{
   assert.equal(token,"fresh");renewals++;return {sub:"alice",sid:"session",exp:(Date.now()+1500)/1000};
  },checkSession:async()=>{if(revoked)throw Error("session");}});
  s.on("echo",(p,ack)=>ack(p));
 });
 await new Promise<void>(r=>http.listen(0,"127.0.0.1",r));
 const client=io("http://127.0.0.1:"+(http.address() as any).port,{transports:["websocket"],reconnection:false});
 const dispose=attachSocketAuthClient(client,async()=>"fresh");
 client.on("disconnect",()=>disconnects++);
 try{
  await new Promise<void>(r=>client.once("connect",()=>r()));const id=client.id;
  await wait(4050);
  assert.equal(client.connected,true);assert.equal(client.id,id);assert.equal(connections,1);assert.ok(renewals>=3);assert.equal(disconnects,0);
  assert.equal(await client.timeout(1000).emitWithAck("echo","state intact"),"state intact");
  revoked=true;await wait(1800);
  assert.equal(client.connected,false);assert.equal(disconnects,1);
 }finally{dispose();client.disconnect();await new Promise<void>(r=>server.close(()=>r()));}
});
function fake(){
 const s:any=new EventEmitter();s.connected=true;s.data={identity:{id:"alice"},sessionId:"session",expires:Date.now()+100};
 s.disconnect=()=>{s.connected=false;s.emit("disconnect");};return s;
}
for(const kind of ["different-user","different-session","expired","malformed","stale","revoked","verification-failed"]){
 test("renewal rejects "+kind+" without extending expiry",async()=>{
  const s=fake(),deadline=s.data.expires;
  attachSocketAuth(s,{refreshLead:20,retryMs:20,verify:async()=>{
   if(kind==="verification-failed")throw Error("signature");
   return {sub:kind==="different-user"?"bob":"alice",sid:kind==="different-session"?"other":"session",
    exp:kind==="expired"?0:kind==="stale"?deadline/1000:kind==="malformed"?"bad":(Date.now()+10000)/1000};
  },checkSession:async()=>{if(kind==="revoked")throw Error("session");}});
  const result:any=await new Promise(r=>s.emit("auth:renew",{token:"signed"},r));
  assert.equal(result.ok,false);assert.equal(s.data.expires,deadline);
  await wait(140);assert.equal(s.connected,false);
 });
}
test("absent refresh expires, and late verification cannot resurrect disconnected socket",async()=>{
 const s=fake();let finish:any;
 attachSocketAuth(s,{verify:()=>new Promise(r=>finish=r),checkSession:async()=>{},refreshLead:20});
 const result=new Promise<any>(r=>s.emit("auth:renew",{token:"slow"},r));
 await wait(140);assert.equal(s.connected,false);
 finish({sub:"alice",sid:"session",exp:(Date.now()+10000)/1000});
 assert.equal((await result).ok,false);
});
test("client refresh listener is disposed and does not send credentials after unmount",async()=>{
 const s:any=new EventEmitter();s.connected=true;let finish:any,sends=0;
 s.timeout=()=>({emit:()=>sends++});
 const dispose=attachSocketAuthClient(s,()=>new Promise(r=>finish=r));
 s.emit("auth:refresh");dispose();finish("secret");await wait(0);
 assert.equal(sends,0);assert.equal(s.listenerCount("auth:refresh"),0);
});
