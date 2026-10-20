import {test} from "node:test";
import assert from "node:assert/strict";
import {StockRuntime} from "../lib/stock-runtime";
import type {StockSocket} from "../lib/stock-feed";
test("lease-free runtime does no I/O without existing lease and preserves unknown status",async()=>{
 let leader=false,requests=0,connections=0;
 const runtime=new StockRuntime({
  env:{ALPACA_KEY_ID:"fixture",ALPACA_SECRET:"fixture"},isLeader:()=>leader,now:()=>Date.parse("2026-10-19T22:00:00Z"),
  socket:()=>{connections++;return {} as StockSocket;},
  fetch:(async()=>{requests++;throw new Error("fixture");}) as typeof fetch,
  publish:async()=>{},instrumentStatus:()=>({halt:"unknown",corporateActionsReconciled:false}),
 });
 await runtime.step();assert.equal(requests,0);assert.equal(connections,0);
 for(const state of Object.values(runtime.snapshot())){assert.equal(state.leader,false);assert.equal(state.halt,"unknown");}
 leader=true;await runtime.step();assert.equal(requests,2);assert.equal(connections,0);
 runtime.stop();await runtime.drained();
});
test("lease revocation fences delayed calendar responses and all socket publication",async()=>{
 let leader=true,resolveClock!:(value:Response)=>void,resolveCalendar!:(value:Response)=>void;
 let requests=0,connections=0,writes=0;
 const runtime=new StockRuntime({
  env:{ALPACA_KEY_ID:"fixture",ALPACA_SECRET:"fixture"},isLeader:()=>leader,now:()=>Date.parse("2026-10-19T22:00:00Z"),
  socket:()=>{connections++;return {} as StockSocket;},
  fetch:(()=>new Promise<Response>(resolve=>{if(requests++===0)resolveClock=resolve;else resolveCalendar=resolve;})) as typeof fetch,
  publish:async()=>{writes++;},instrumentStatus:()=>({halt:"unknown",corporateActionsReconciled:false}),
 });
 const pending=runtime.step();
 leader=false;runtime.revoke();
 resolveClock(new Response(JSON.stringify({is_open:false,timestamp:"2026-10-19T22:00:00Z",next_open:"2026-10-20T13:30:00Z",next_close:"2026-10-20T20:00:00Z"})));
 resolveCalendar(new Response(JSON.stringify([{date:"2026-10-20",open:"09:30",close:"16:00"}])));
 await pending;await runtime.drained();
 assert.equal(connections,0);assert.equal(writes,0);
 for(const state of Object.values(runtime.snapshot())){assert.equal(state.clock,null);assert.equal(state.connected,false);assert.equal(state.tick,null);}
 runtime.stop();
});
