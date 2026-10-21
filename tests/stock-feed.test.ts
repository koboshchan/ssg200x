import {test} from "node:test";
import assert from "node:assert/strict";
import {AlpacaIexFeed,type StockSocket} from "../lib/stock-feed";
import type {StockTick} from "../lib/stock-policy";
class Socket implements StockSocket {
  sent:string[]=[];closed=false;
  onopen:(()=>void)|null=null; onclose:(()=>void)|null=null; onerror:(()=>void)|null=null;
  onmessage:((event:{data:unknown})=>void)|null=null;
  send(s:string){this.sent.push(s);} close(){this.closed=true;}
  message(data:unknown){this.onmessage?.({data:JSON.stringify(data)});}
}
function setup() {
  const sockets:Socket[]=[],ticks:StockTick[]=[],states:string[]=[];
  let leader=true,permitted=true;
  const now=Date.parse("2026-10-19T15:00:00Z");
  const feed=new AlpacaIexFeed({env:{ALPACA_KEY_ID:"fixture-key",ALPACA_SECRET:"fixture-secret"},permitted:()=>permitted,isLeader:()=>leader,now:()=>now,
    socket:url=>{assert.equal(url,"wss://stream.data.alpaca.markets/v2/iex");const s=new Socket();sockets.push(s);return s;},onTick:t=>ticks.push(t),onState:s=>states.push(s)});
  const print=(overrides={})=>({T:"t",S:"AAPL",p:200,s:100,c:["@"],t:new Date(now-100).toISOString(),...overrides});
  function connect(){assert.equal(feed.start(),true);const s=sockets.at(-1)!;s.onopen?.();s.message([{T:"success",msg:"authenticated"}]);s.message([{T:"subscription",trades:["AAPL","TSLA","NVDA","MSFT","AMD","SPCX","SPY"],quotes:["AAPL","TSLA","NVDA","MSFT","AMD","SPCX","SPY"]}]);return s;}
  return {feed,sockets,ticks,states,print,connect,setLeader:(v:boolean)=>leader=v,setPermission:(v:boolean)=>permitted=v};
}
test("auth then subscribe, array trades filtered, no bars/quotes as execution",()=>{
  const h=setup(),s=h.connect();
  assert.deepEqual(JSON.parse(s.sent[0]),{action:"auth",key:"fixture-key",secret:"fixture-secret"});
  assert.deepEqual(JSON.parse(s.sent[1]),{action:"subscribe",trades:["AAPL","TSLA","NVDA","MSFT","AMD","SPCX","SPY"],quotes:["AAPL","TSLA","NVDA","MSFT","AMD","SPCX","SPY"]});
  s.message([h.print(),h.print(),h.print({S:"GOOG"}),h.print({T:"q"}),h.print({T:"b"}),h.print({p:-1}),h.print({c:["T"]}),h.print({t:"2026-10-19T14:59:00Z"})]);
  assert.equal(h.ticks.length,1);
  assert.doesNotMatch(JSON.stringify(h.ticks),/fixture-/);
  assert.equal(h.feed.start(),false);
});
test("permission/leader loss disconnects, fences callbacks on reconnect",()=>{
  const h=setup(),s=h.connect(),late=s.onmessage;
  h.setLeader(false);s.message([h.print()]);
  assert.equal(s.closed,true);assert.equal(h.ticks.length,0);
  h.setLeader(true);h.connect();late?.({data:JSON.stringify([h.print()])});
  assert.equal(h.ticks.length,0);
  h.setPermission(false);h.sockets.at(-1)!.message([h.print()]);
  assert.equal(h.feed.start(),false);
});
test("auth/entitlement errors terminal, transport errors retryable",()=>{
  for(const code of [402,409,410]){const h=setup();h.connect().message([{T:"error",code,msg:"never log raw provider message"}]);assert.equal(h.feed.start(),false);}
  const h=setup();h.connect().onerror?.();assert.equal(h.feed.start(),true);
  assert.deepEqual(Array.from({length:7},()=>h.feed.retryDelay()),[1000,2000,4000,8000,16000,30000,30000]);
});
test("malformed frames fail closed and no preauth ticks",()=>{
  const h=setup();h.feed.start();const s=h.sockets[0];
  s.message([h.print()]);assert.equal(h.ticks.length,0);
  s.onmessage?.({data:"{"});assert.equal(s.closed,true);
});

test("trade corrections/cancels invalidate connection rather than retaining executable cache",()=>{
  for(const T of ["c","x"]){const h=setup(),s=h.connect();s.message([{T,S:"AAPL"}]);assert.equal(s.closed,true);assert.equal(h.states.at(-1),"disconnected");}
});
test("missing credentials never construct upstream sockets",()=>{
  let called=false;
  const feed=new AlpacaIexFeed({env:{},permitted:()=>true,isLeader:()=>true,now:()=>0,socket:()=>{called=true;return new Socket();},onTick:()=>{},onState:()=>{}});
  assert.equal(feed.start(),false);assert.equal(called,false);
});

test("one pooled connection emits independent same-timestamp trades for all seven symbols",()=>{
  const h=setup(),s=h.connect();
  s.message(["AAPL","TSLA","NVDA","MSFT","AMD","SPCX","SPY"].map(S=>h.print({S})));
  assert.deepEqual(h.ticks.map(t=>t.symbol),["AAPL","TSLA","NVDA","MSFT","AMD","SPCX","SPY"]);
  s.message(["AAPL","TSLA","NVDA","MSFT","AMD","SPCX","SPY"].map(S=>h.print({S})));
  assert.equal(h.ticks.length,7);assert.equal(h.sockets.length,1);
  s.onerror?.();const next=h.connect();
  assert.equal(h.sockets.length,2);
  assert.deepEqual(JSON.parse(next.sent[1]).trades,["AAPL","TSLA","NVDA","MSFT","AMD","SPCX","SPY"]);
  h.feed.stop();
});
test("partial pooled subscription is not ready",()=>{
  const h=setup();h.feed.start();const s=h.sockets[0];
  s.message([{T:"success",msg:"authenticated"}]);
  s.message([{T:"subscription",trades:["AAPL"],quotes:["AAPL"]}]);
  assert.equal(s.closed,true);assert.equal(h.states.includes("subscribed"),false);
});
test("SPCX zero-ask stale quote never becomes executable or removes configured subscription",()=>{
  const h=setup(),s=h.connect();
  s.message([{T:"q",S:"SPCX",t:"2026-10-19T20:00:02.387842451Z",bp:141.74,ap:0,bx:"V",ax:" "}]);
  assert.equal(h.ticks.length,0);
  assert.equal(s.closed,false);
  for(const quote of [
    {bp:150,ap:149,bx:"V",ax:"V"},
    {bp:149,ap:150,bx:"",ax:""},
    {bp:149,ap:150,bx:"V",ax:"V"},
  ])s.message([{T:"q",S:"SPCX",t:"2026-10-19T14:59:59.900Z",...quote}]);
  // Quotes are diagnostic only, including valid ones. Only a validated trade
  // can enter execution policy; SPCX has the same rule as all other stocks.
  assert.equal(h.ticks.length,0);
  s.message([h.print({S:"SPCX"})]);
  assert.equal(h.ticks.length,1);assert.equal(h.ticks[0].symbol,"SPCX");
  h.feed.stop();
});

test("status metadata is nonblocking and parser uses strict 60-second stock age",()=>{
 const now=Date.parse("2026-10-19T15:00:00Z");
 for(const age of [59999,60000,-1]){
  const h=setup(),s=h.connect();s.message([{T:"s",S:"AAPL"}]);
  assert.equal(s.closed,false);
  s.message([h.print({t:new Date(now-age).toISOString()})]);
  assert.equal(h.ticks.length,age===59999?1:0);
 }
});
