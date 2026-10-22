import {test} from "node:test";
import assert from "node:assert/strict";
import {StockRuntime} from "../lib/stock-runtime";
import type {StockSocket} from "../lib/stock-feed";
import type {StockTick,StockExecutionState} from "../lib/stock-policy";
import {applyStockPublication} from "../lib/stock-publication";
import {stockExecutionPolicy} from "../lib/stock-policy";
import {stockPauseReason} from "../lib/stock-status";
import {freshRoom,register} from "../lib/poker";
import {openPosition} from "../lib/finance";
const start=Date.parse("2026-10-22T15:00:00Z");
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function fixture(publish:ConstructorParameters<typeof StockRuntime>[0]["publish"]){
 let now=start,leader=true,until=start+14000;
 const socket:StockSocket={send(){},close(){},onopen:null,onclose:null,onerror:null,onmessage:null};
 const runtime=new StockRuntime({symbols:()=>["TSLA"],env:{ALPACA_KEY_ID:"fixture",ALPACA_SECRET:"fixture"},
  isLeader:()=>leader,leaseUntil:()=>until,now:()=>now,socket:()=>socket,
  fetch:(async(url)=>new Response(JSON.stringify(String(url).includes("/clock")?
   {is_open:true,timestamp:new Date(now).toISOString(),next_open:"2026-10-23T13:30:00Z",next_close:"2026-10-22T20:00:00Z"}:
   [{date:"2026-10-22",open:"09:30",close:"16:00"}]))) as typeof fetch,publish});
 await runtime.step();
 socket.onopen?.();
 const msg=(body:unknown)=>socket.onmessage?.({data:JSON.stringify(body)});
 msg([{T:"success",msg:"authenticated"}]);msg([{T:"subscription",trades:["TSLA"],quotes:["TSLA"]}]);
 const tick=(n:number)=>msg([{T:"t",S:"TSLA",p:n,s:1,c:["@"],t:new Date(now++).toISOString()}]);
 return {runtime,tick,setTime:(v:number)=>{now=v;until=v+14000;},lose:()=>{leader=false;runtime.revoke();},socket};
}
test("blocked publication beyond lease lifetime reads renewed state at commit; queue coalesces metadata, not ordered prints",async()=>{
 let release!:()=>void,entered!:()=>void;
 const blocked=new Promise<void>(r=>release=r),began=new Promise<void>(r=>entered=r);
 const batches:number[][]=[],leases:number[]=[];
 let calls=0;
 const f=await fixture(async(current,ticks)=>{if(++calls===1){entered();await blocked;}leases.push(current().TSLA.leaseUntil!);batches.push(ticks.map(t=>t.price));});
 await began;for(let i=0;i<100;i++)f.tick(200+i);
 f.setTime(start+24000);await f.runtime.step();release();await f.runtime.drained();
 assert.ok(calls<=2);assert.deepEqual(batches.flat(),Array.from({length:100},(_,i)=>200+i));
 assert.ok(leases.every(v=>v===start+38000));f.runtime.stop();await f.runtime.drained();
});
test("revocation while Mongo is blocked fences the in-flight getter and all queued prints",async()=>{
 let release!:()=>void;const blocked=new Promise<void>(r=>release=r);let fenced=false,commits=0;
 const f=await fixture(async(current)=>{await blocked;try{current();commits++;}catch{fenced=true;throw Error("fenced");}});
 await flush();f.tick(200);f.lose();release();await f.runtime.drained();
 assert.equal(commits,0);assert.equal(fenced,true);assert.equal(f.runtime.snapshot().TSLA.connected,false);
 f.runtime.stop();
});
test("bounded overflow fails closed instead of silently skipping trigger prints",async()=>{
 let release!:()=>void;const blocked=new Promise<void>(r=>release=r);let committed=0;
 const f=await fixture(async(current)=>{await blocked;if(current().TSLA.connected)committed++;});
 await flush();for(let i=0;i<600;i++)f.tick(200+i);
 release();await f.runtime.drained();assert.equal(committed,0);assert.equal(f.runtime.snapshot().TSLA.connected,false);f.runtime.stop();
});
test("idle feed publishes renewed lease but never renews trade freshness",async()=>{
 let last:Record<string,StockExecutionState>={};
 const f=await fixture(async(current)=>{last=current();});
 f.tick(200);await f.runtime.drained();
 f.setTime(start+20000);await f.runtime.step();await f.runtime.drained();
 assert.equal(last.TSLA.leaseUntil,start+34000);assert.equal(stockExecutionPolicy(last.TSLA,start+20000,["TSLA"]).executable,true);
 f.setTime(start+61000);await f.runtime.step();await f.runtime.drained();
 assert.equal(stockExecutionPolicy(last.TSLA,start+61000,["TSLA"]).executable,false);f.runtime.stop();
});
const tick=(price:number,timestamp=start):StockTick=>({symbol:"TSLA",price,timestamp,receivedAt:timestamp,feed:"alpaca-iex"});
const state=(t:StockTick):StockExecutionState=>({symbol:"TSLA",authorized:true,leader:true,connected:true,leaseUntil:start+14000,tick:t,
 clock:{isOpen:true,timestamp:start,receivedAt:start,nextOpen:start+86400000,nextClose:start+18000000},
 sessions:[{date:"2026-10-22",open:start-5400000,close:start+18000000}]});
test("batched intermediate TP crossing settles before later reversal; latest snapshot never skips prints",()=>{
 const room=freshRoom(),who={id:"test",name:"Test",email:"test@example.test",admin:true};
 register(room,who);room.quotes={TSLA:{micro:200000000,at:start}};room.stockExecution={TSLA:state(tick(200))};
 openPosition(room,who,"TSLA","long",10000,2,"position",start,{takeProfit:210000000});
 const states={TSLA:state(tick(195,start+2))};
 applyStockPublication(room,()=>structuredClone(states),[tick(215,start+1),tick(195,start+2)],start+3);
 assert.equal(room.members[0].positions!.length,0);assert.equal(room.members[0].closedPositions!.length,1);
 assert.equal(room.quotes!.TSLA!.micro,195000000);assert.equal(room.stockExecution!.TSLA!.tick!.price,195);
});
test("transaction retry obtains new lease and disconnected state; getter cannot turn stale ticks fresh",()=>{
 const room=freshRoom();room.quotes={TSLA:{micro:200000000,at:start}};room.stockExecution={TSLA:state(tick(200))};
 let calls=0;
 const current=()=>{calls++;return {TSLA:{...state(tick(200)),leaseUntil:start+40000,connected:false}};};
 applyStockPublication(room,current,[],start+24000);
 assert.equal(calls,1);assert.equal(room.stockExecution!.TSLA!.leaseUntil,start+40000);
 assert.equal(stockExecutionPolicy(room.stockExecution!.TSLA!,start+24000,["TSLA"]).executable,false);
});
test("pause reasons distinguish real feed failures and expired browser status",()=>{
 assert.equal(stockPauseReason({executable:false,validUntil:start+1000,reason:"disconnected"},start),"Stock feed disconnected");
 assert.equal(stockPauseReason({executable:true,validUntil:start,reason:"fresh_regular_session"},start),"Stock execution status expired");
});
test("coalesced reconnect cannot resurrect the prior connection's accepted mark",()=>{
 const room=freshRoom();room.quotes={TSLA:{micro:200000000,at:start}};
 room.stockExecution={TSLA:{...state(tick(200)),feedEpoch:"old"}};
 applyStockPublication(room,()=>({TSLA:{...state(tick(201,start+1)),feedEpoch:"new"}}),[],start+2);
 assert.equal(room.stockExecution!.TSLA!.tick,null);
 assert.equal(stockExecutionPolicy(room.stockExecution!.TSLA!,start+2,["TSLA"]).executable,false);
});
