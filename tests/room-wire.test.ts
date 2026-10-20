import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {freshRoom,register} from "../lib/poker";
import {publicRoom,ROOM_WIRE_LIMITS} from "../lib/public";
import {settledNotices} from "../lib/room-sync";
import {emitState,createStateReceiver} from "../runtime/state-stream.mjs";
const who={id:"alice",name:"Alice",email:"alice@test.com",admin:false};
function fixture(){
 const r=freshRoom();register(r,who);const m=r.members[0];m.holdings=[];m.positions=[];
 m.closedPositions=Array.from({length:30},(_,i)=>({id:"00000000-0000-4000-8000-"+String(i).padStart(12,"0"),symbol:"BTC" as const,side:"long" as const,leverage:2,entry:60000000000,exit:61000000000,margin:10000,realizedPnl:333,reason:"Manual" as const,closedAt:1770000000000+i}));
 m.spins=Array.from({length:30},(_,i)=>({id:"roulette-"+i,number:i,stake:100,returned:0,at:i}));
 m.activity=Array.from({length:40},(_,i)=>"Liquidated long BTC · 100.00 returned · position "+m.closedPositions![i%30].id);
 r.log=Array.from({length:60},(_,i)=>"Alice calls $20.00 in hand "+i);return r;
}
test("DTO bounds recent windows, keeps every closed row and stable UI/action IDs without mutating storage",()=>{
 const r=fixture(),before=JSON.stringify(r),v=publicRoom(r,who);
 assert.equal(v.log.length,ROOM_WIRE_LIMITS.pokerLog);assert.equal(v.activity.length,12);assert.equal(v.spins.length,12);
 assert.equal(v.closedPositions.length,30);assert.equal(v.closedPositions[0].id,r.members[0].closedPositions![0].id);
 assert.equal("margin" in v.closedPositions[0],false);assert.equal("checkedAt" in v.stockExecution.AAPL,false);
 assert.equal(settledNotices(v.activity)[0].id,v.closedPositions[0].id);
 assert.equal(JSON.stringify(r),before);
});
test("representative heavy room sends a small one-field diff and no unchanged frame",()=>{
 const r=fixture(),next=publicRoom(r,who);
 const legacy={...next,stockExecution:Object.fromEntries(Object.entries(next.stockExecution).map(([k,v])=>[k,{...v,checkedAt:next.serverNow}])),closedPositions:r.members[0].closedPositions,activity:r.members[0].activity,spins:r.members[0].spins,log:r.log};
 const frames:any[]=[],socket={emit:(_event:string,m:any)=>frames.push(m)};
 emitState(socket,"room:state",next,false,100);
 const updated={...next,quotes:{BTC:{micro:61000000000,at:100}}};
 emitState(socket,"room:state",updated,false,101);
 const updated2={...updated,quotes:{BTC:{...updated.quotes.BTC,micro:61000000001}}};
 emitState(socket,"room:state",updated2,false,102);
 assert.equal(emitState(socket,"room:state",updated2,false,103),false);
 const receiver=createStateReceiver(()=>assert.fail("unexpected resync"));
 for(const frame of frames)assert.equal(receiver.receive("room:state",frame).ok,true);
 const bytes=(v:unknown)=>Buffer.byteLength(JSON.stringify(v));
 assert.ok(bytes(next)<bytes(legacy)*.8);assert.ok(bytes(frames[2])<300);
 console.log(JSON.stringify({legacyBytes:bytes(legacy),trimmedBytes:bytes(next),fullEnvelopeBytes:bytes(frames[0]),singlePriceDiffBytes:bytes(frames[2]),noOpFrames:0}));
});
test("actual server has exactly one room emission helper, including connect, polling and recovery",()=>{
 const server=readFileSync(new URL("../server.mjs",import.meta.url),"utf8");
 assert.equal((server.match(/emitRoomState\(socket,data,force\)/g)||[]).length,1);
 assert.doesNotMatch(server,/\.emit\(["']room:state/);
 assert.match(server,/void pushState\(socket,true\)/);
 assert.match(server,/return pushState\(socket,!socket.data.initialized,new Map\(/);
 assert.match(server,/socket.data.forceFull=true/);
 const helper=readFileSync(new URL("../runtime/room-state.mjs",import.meta.url),"utf8");
 assert.match(helper,/emitState\(socket,"room:state",data.room,force\)/);
});

import {createServer} from "node:http";
import {Server} from "socket.io";
import {io} from "socket.io-client";
// @ts-expect-error Shared JavaScript room emission helper.
import {emitRoomState} from "../runtime/room-state.mjs";
test("actual room helper transports trimmed DTO, preserves wallet keys and recovers gaps",async()=>{
 const http=createServer(),server=new Server(http,{transports:["websocket"]});
 const r=fixture(),bob={id:"bob",name:"Bob",email:"bob@test.com",admin:false};
 register(r,bob);r.members[1].wallet=12345;
 let peer:any;const snapshot=publicRoom(r,who);
 server.on("connection",s=>{peer=s;s.on("state:resync",()=>emitRoomState(s,{maintenance:{blocked:false},room:snapshot},true));emitRoomState(s,{maintenance:{blocked:false},room:snapshot},true);});
 await new Promise<void>(resolve=>http.listen(0,"127.0.0.1",resolve));
 const client=io("http://127.0.0.1:"+(http.address() as any).port,{transports:["websocket"],autoConnect:false,reconnection:false});
 const frames:any[]=[],values:any[]=[];
 const receiver=createStateReceiver(event=>client.emit("state:resync",event));
 let nextResolve:()=>void=()=>{};
 client.on("room:state",frame=>{frames.push(frame);const result=receiver.receive("room:state",frame);if(result.ok){values.push(result.value);nextResolve();}});
 const next=()=>new Promise<void>(resolve=>{nextResolve=resolve;});
 try{
  let ready=next();client.connect();await ready;
  assert.equal(values[0].log.length,20);assert.deepEqual(values[0].transferHistoryKeys,snapshot.transferHistoryKeys);
  assert.equal(JSON.stringify(values[0]).includes("bob@test.com"),false);
  const changed={...snapshot,quotes:{BTC:{micro:123,at:100}}};
  ready=next();emitRoomState(peer,{maintenance:{blocked:false},room:changed});await ready;
  assert.equal(frames.at(-1).type,"diff");assert.equal(values.at(-1).quotes.BTC.micro,123);
  assert.deepEqual(values.at(-1).transferHistoryKeys,snapshot.transferHistoryKeys);
  ready=next();peer.emit("room:state",{type:"diff",seq:999,snapshotVersion:1,patch:{op:"replace",value:{me:{wallet:-1}}}});await ready;
  assert.equal(frames.at(-1).type,"full");assert.equal(values.at(-1).me.wallet,snapshot.me.wallet);
 }finally{client.disconnect();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
