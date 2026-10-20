import {test} from "node:test";
import assert from "node:assert/strict";
import {stockExecutionPolicy, type StockExecutionState} from "../lib/stock-policy";
const now=Date.parse("2026-10-19T15:00:00Z");
function state(): StockExecutionState {return {
  symbol:"AAPL",authorized:true,connected:true,leader:true,halt:"clear",corporateActionsReconciled:true,
  tick:{symbol:"AAPL",feed:"alpaca-iex",price:200,timestamp:now-100,receivedAt:now},
  sessions:[{date:"2026-10-19",open:Date.parse("2026-10-19T13:30:00Z"),close:Date.parse("2026-10-19T20:00:00Z")}],
  clock:{isOpen:true,timestamp:now,receivedAt:now,nextOpen:Date.parse("2026-10-20T13:30:00Z"),nextClose:Date.parse("2026-10-19T20:00:00Z")},
};}
test("fresh regular-session price only",()=>assert.equal(stockExecutionPolicy(state(),now).executable,true));
test("all stock executions share failclosed policy without mutation",()=>{
  const patches: Partial<StockExecutionState>[] = [
    {authorized:false},{connected:false},{leader:false},{halt:"unknown"},{halt:"halted"},
    {corporateActionsReconciled:false},{clock:null},{sessions:[]},{tick:null},
    {tick:{...state().tick!,timestamp:now-15_001}},
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

test("all four equities use their own ticks, never cross-symbol prices",()=>{
  for(const symbol of ["AAPL","TSLA","NVDA","MSFT"] as const){
    const s=state();s.symbol=symbol;s.tick={...s.tick!,symbol};
    assert.equal(stockExecutionPolicy(s,now).executable,true);
    s.tick={...s.tick!,symbol:symbol==="AAPL"?"TSLA":"AAPL"};
    assert.equal(stockExecutionPolicy(s,now).executable,false);
  }
});
