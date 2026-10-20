import {test} from "node:test";
import assert from "node:assert/strict";
import {stockExecutionPolicy, type StockExecutionState} from "../lib/stock-policy";
const now=Date.parse("2026-10-19T15:00:00Z");
function state(): StockExecutionState {return {
  symbol:"AAPL",authorized:true,connected:true,leader:true,
  tick:{symbol:"AAPL",feed:"alpaca-iex",price:200,timestamp:now-100,receivedAt:now},
  sessions:[{date:"2026-10-19",open:Date.parse("2026-10-19T13:30:00Z"),close:Date.parse("2026-10-19T20:00:00Z")}],
  clock:{isOpen:true,timestamp:now,receivedAt:now,nextOpen:Date.parse("2026-10-20T13:30:00Z"),nextClose:Date.parse("2026-10-19T20:00:00Z")},
};}
test("fresh regular-session price only",()=>assert.equal(stockExecutionPolicy(state(),now).executable,true));
test("all stock executions share failclosed policy without mutation",()=>{
  const patches: Partial<StockExecutionState>[] = [
    {authorized:false},{connected:false},{leader:false},
    {clock:null},{sessions:[]},{tick:null},
    {tick:{...state().tick!,timestamp:now-60_000}},
    {tick:{...state().tick!,timestamp:now+1}},
    {tick:{...state().tick!,price:NaN}},
    {clock:{...state().clock!,receivedAt:now-60_001}},
    {clock:{...state().clock!,isOpen:false}},
  ];
  for(const patch of patches) {
    const s={...state(),...patch}, before=structuredClone(s);
    assert.equal(stockExecutionPolicy(s,now).executable,false);
    assert.deepEqual(s,before);
  }
});

test("all six equities use their own ticks, never cross-symbol prices",()=>{
  for(const symbol of ["AAPL","TSLA","NVDA","MSFT","AMD","SPCX"] as const){
    const s=state();s.symbol=symbol;s.tick={...s.tick!,symbol};
    assert.equal(stockExecutionPolicy(s,now).executable,true);
    s.tick={...s.tick!,symbol:symbol==="AAPL"?"TSLA":"AAPL"};
    assert.equal(stockExecutionPolicy(s,now).executable,false);
  }
});

test("play-money metadata is nonblocking and both tick clocks expire strictly at 60 seconds",()=>{
 for(const halt of ["clear","unknown","halted"] as const) for(const corporateActionsReconciled of [false,true]){
  const s={...state(),halt,corporateActionsReconciled};
  assert.equal(stockExecutionPolicy(s,now).executable,true);
  for(const field of ["timestamp","receivedAt"] as const){
   for(const [age,expected] of [[59999,true],[60000,false],[-1,false]] as const){
    const tick={...s.tick!,[field]:now-age};
    assert.equal(stockExecutionPolicy({...s,tick},now).executable,expected);
   }
  }
 }
});
test("stock mark strict 60-second boundary and future timestamps",()=>{
 for(const age of [59999,60000,60001]){
  const s=state();s.tick={...s.tick!,timestamp:now-age,receivedAt:now-age};
  assert.equal(stockExecutionPolicy(s,now).executable,age<60000);
 }
 for(const field of ["timestamp","receivedAt"] as const){
  const s=state();s.tick={...s.tick!,[field]:now+1};
  assert.equal(stockExecutionPolicy(s,now).executable,false);
 }
});
test("regular session opens inclusively and closes exclusively without calendar inference",()=>{
 const s=state();s.sessions=[{date:"2026-10-19",open:now,close:now+1000}];
 s.clock={...s.clock!,nextClose:now+1000};s.tick={...s.tick!,timestamp:now};
 assert.equal(stockExecutionPolicy(s,now).executable,true);
 assert.equal(stockExecutionPolicy(s,now+1000).executable,false);
 s.sessions=[];assert.equal(stockExecutionPolicy(s,now).executable,false);
});
