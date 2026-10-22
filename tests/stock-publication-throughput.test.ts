import {test} from "node:test";
import assert from "node:assert/strict";
import {StockRuntime} from "../lib/stock-runtime";
import type {StockSocket} from "../lib/stock-feed";
import type {StockTick} from "../lib/stock-policy";
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
test("six-symbol sustained 60 prints/sec keeps commit lag bounded instead of growing a 24s serial backlog",async()=>{
 // A deterministic load envelope, NOT a claim about the unmeasured production
 // tick rate. Six symbols each trade at 10Hz, 350ms provider->receipt delay.
 // Each simulated fenced room/candle transaction takes 250ms. The legacy
 // one-transaction-per-print queue cannot sustain this load; batching must.
 const symbols=["TSLA","AAPL","NVDA","MSFT","SPY","SPCX"];
 const start=Date.parse("2026-10-22T15:00:00Z");let now=start;
 const socket:StockSocket={send(){},close(){},onopen:null,onclose:null,onerror:null,onmessage:null};
 let completion:{at:number;finish:()=>void}|undefined;
 const committed:StockTick[]=[],lags:number[]=[],leases:number[]=[],batches:number[]=[];
 let active=0,maxActive=0;
 const runtime=new StockRuntime({
  symbols:()=>symbols,env:{ALPACA_KEY_ID:"fixture",ALPACA_SECRET:"fixture"},
  now:()=>now,isLeader:()=>true,leaseUntil:()=>now+14000,socket:()=>socket,
  fetch:(async(url)=>new Response(JSON.stringify(String(url).includes("/clock")?
   {is_open:true,timestamp:new Date(now).toISOString(),next_open:"2026-10-23T13:30:00Z",next_close:"2026-10-22T20:00:00Z"}:
   [{date:"2026-10-22",open:"09:30",close:"16:00"}]))) as typeof fetch,
  publish:async(current,ticks)=>{
   active++;maxActive=Math.max(active,maxActive);
   await new Promise<void>(finish=>{assert.equal(completion,undefined);completion={at:now+250,finish};});
   try{const states=current();
   for(const tick of ticks){committed.push(tick);lags.push(now-tick.receivedAt);leases.push(states[tick.symbol].leaseUntil!-now);}
   batches.push(ticks.length);}finally{active--;}
  },
 });
 await runtime.step();socket.onopen?.();
 socket.onmessage?.({data:JSON.stringify([{T:"success",msg:"authenticated"},{T:"subscription",trades:symbols,quotes:symbols}])});
 await flush();
 let sent=0;
 for(let elapsed=0;elapsed<=61000;elapsed+=50){
  now=start+elapsed;
  if(elapsed<60000&&elapsed%100===0){
   socket.onmessage?.({data:JSON.stringify(symbols.map((symbol,index)=>({T:"t",S:symbol,p:200+index+elapsed/100000,s:1,c:["@"],t:new Date(now-350).toISOString()})))});
   sent+=symbols.length;
  }
  if(elapsed%100===0)await runtime.step();
  if(completion&&completion.at<=now){const done=completion;completion=undefined;done.finish();}
  await flush();
 }
 assert.equal(sent,3600);assert.equal(committed.length,sent);
 assert.equal(maxActive,1);
 assert.ok(Math.max(...lags)<=500,"receive-to-commit lag must stay <=500ms");
 assert.ok(Math.max(...lags)+350<=850,"provider-to-commit lag must stay <=850ms");
 assert.ok(leases.every(remaining=>remaining===14000),"every commit uses renewed lease");
 assert.ok(Math.max(...batches)<=18,"batch size must remain bounded under sustained load");
 // No print dropped or reordered, including cross-symbol arrival order.
 for(let i=0;i<committed.length;i++)assert.equal(committed[i].symbol,symbols[i%6]);
 for(let i=6;i<committed.length;i++)assert.ok(committed[i].timestamp>committed[i-6].timestamp);
 const first=lags.slice(0,360),last=lags.slice(-360);
 assert.ok(Math.max(...last)<=Math.max(...first),"lag does not increase over 60s");
 console.log(JSON.stringify({symbols:symbols.length,prints:sent,simulatedSeconds:60,printsPerSecond:60,transactionMs:250,
  providerReceiptMs:350,maxReceiptCommitMs:Math.max(...lags),maxProviderCommitMs:Math.max(...lags)+350,
  maxBatch:Math.max(...batches),transactions:batches.length,expiredLeaseCommits:leases.filter(v=>v<=0).length}));
 runtime.stop();
 if(completion){const done=completion;completion=undefined;done.finish();}
 await runtime.drained();
});
