import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {Server} from "socket.io";
import {io as connect} from "socket.io-client";
import {AIRDROP_EVENT,createAirdropReceiver,createAirdropBroadcaster} from "../runtime/airdrop-events.mjs";
const id="a".repeat(64),other="b".repeat(64),event={id,amount:25000,at:Date.now()};
test("client dedupes canonical receipts, rejects malformed cents and never replays to new subscribers",()=>{
 const output:unknown[]=[];
 const receive=createAirdropReceiver(e=>output.push(e));
 assert.equal(receive(event),true);assert.equal(receive({...event,amount:3}),false);
 assert.equal(receive({...event,id:other}),true);
 for(const bad of [null,{}, {...event,id:"x"},{...event,amount:1.1},{...event,amount:0},{...event,amount:Number.MAX_SAFE_INTEGER+1}])assert.equal(receive(bad),false);
 assert.equal(output.length,2);
});
test("server coalesces concurrent delivery, checks committed receipt, sends once per airdrop not recipient",async()=>{
 const events:unknown[]=[];let reads=0;
 const socket={connected:true,data:{expires:Date.now()+10000},emit:(name:string,p:unknown)=>events.push([name,p])};
 const send=createAirdropBroadcaster({sockets:{sockets:new Map([["one",socket],["two",{...socket}]])}},{async findOne({_id}:{_id:string}){reads++;await new Promise(r=>setImmediate(r));return _id===id?{_id:id,amount:event.amount,at:event.at}:null;}});
 assert.equal(await send(other),false);assert.equal(events.length,0);
 const result=await Promise.all(Array.from({length:12},()=>send(id)));
 assert.ok(result.every(Boolean));assert.equal(reads,2);assert.equal(events.length,2);
 assert.equal(await send(id),false);assert.equal(events.length,2);
 assert.deepEqual(events[0],[AIRDROP_EVENT,event]);
});
test("real Socket.IO connected clients get each distinct event, disconnected and reconnecting clients get no history",async()=>{
 const http=createServer(),io=new Server(http,{transports:["websocket"]});
 io.on("connection",s=>{s.data.expires=Date.now()+60000;});
 await new Promise<void>(r=>http.listen(0,"127.0.0.1",r));
 const port=(http.address() as any).port;
 const options={transports:["websocket"],reconnection:false,forceNew:true};
 const a=connect("http://127.0.0.1:"+port,options),b=connect("http://127.0.0.1:"+port,options);
 const aa:unknown[]=[],bb:unknown[]=[];
 // Same receiver intentionally survives the reconnect.
 const receive=createAirdropReceiver(e=>aa.push(e));a.on(AIRDROP_EVENT,receive);b.on(AIRDROP_EVENT,e=>bb.push(e));
 try{
  await Promise.all([a,b].map(s=>new Promise<void>(r=>s.on("connect",r))));
  const receipts={async findOne({_id}:{_id:string}){return {_id,amount:25000,at:event.at};}};
  const broadcast=createAirdropBroadcaster(io,receipts);
  await broadcast(id);await new Promise(r=>setTimeout(r,30));
  assert.equal(aa.length,1);assert.equal(bb.length,1);
  a.disconnect();await new Promise(r=>setTimeout(r,20));
  await broadcast(other);await new Promise(r=>setTimeout(r,30));
  assert.equal(aa.length,1);assert.equal(bb.length,2);
  a.connect();await new Promise<void>(r=>a.once("connect",r));
  await new Promise(r=>setTimeout(r,30));assert.equal(aa.length,1);
  await broadcast(id);await new Promise(r=>setTimeout(r,30));assert.equal(aa.length,1);assert.equal(bb.length,2);
  await broadcast("c".repeat(64));await new Promise(r=>setTimeout(r,30));
  assert.equal(aa.length,2);assert.equal(bb.length,3);
 }finally{a.close();b.close();await io.close();http.close();}
});
