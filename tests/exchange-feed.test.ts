import {test} from "node:test";
import assert from "node:assert/strict";
import {ExchangeFeed,STALE_MS,type Tick} from "../lib/exchange-feed";
import {SYMBOLS} from "../lib/market-shared";
import {freshRoom,register} from "../lib/poker";
import {applyMarketTick} from "../lib/market-tick";
import {openPosition} from "../lib/finance";
function fixture(apply?:(ticks:Tick[])=>Promise<void>,capacity?:number){
 let now=Date.now();const sockets:any[]=[];const applied:Tick[]=[];const logs:string[]=[];
 const feed=new ExchangeFeed({now:()=>now,socket:()=>{const ws={readyState:1,send:(s:string)=>ws.sent.push(JSON.parse(s)),sent:[] as any[],close(){ws.readyState=3;},onopen:null as any,onmessage:null as any,onclose:null as any,onerror:null as any};sockets.push(ws);return ws;},apply:apply??(async ticks=>{applied.push(...ticks);}),log:s=>logs.push(s)},capacity);
 const tick=(sequence:number,price="100",at=now)=>JSON.stringify({type:"ticker",sequence,product_id:"BTC-USD",price,time:new Date(at).toISOString()});
 return {feed,sockets,applied,logs,tick,now:()=>now,advance:(ms:number)=>{now+=ms;}};
}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
test("one socket subscribes exact whitelist and reconnects with backoff/resubscription",()=>{
 const f=fixture();f.feed.step();f.feed.step();assert.equal(f.sockets.length,1);f.sockets[0].onopen();
 assert.deepEqual(f.sockets[0].sent[0].product_ids,SYMBOLS.map(s=>s+"-USD"));
 assert.deepEqual(f.sockets[0].sent[0].channels,["ticker","heartbeat"]);
 f.sockets[0].onclose();f.feed.step();assert.equal(f.sockets.length,1);f.advance(500);f.feed.step();f.sockets[1].onopen();assert.deepEqual(f.sockets[1].sent[0],f.sockets[0].sent[0]);f.feed.stop();
});
test("reject malformed, nonwhitelist, nonfinite, duplicate, old sequence/time and future ticks",async()=>{
 const f=fixture();f.feed.receive("null");f.feed.receive("{}");
 f.feed.receive(f.tick(1));f.feed.receive(f.tick(1,"200"));f.feed.receive(f.tick(0,"200"));f.feed.receive(f.tick(2,"200",f.now()-1));
 for(const price of ["NaN","Infinity","0","-1","", "1e20"])f.feed.receive(f.tick(3,price));
 f.feed.receive(f.tick(4,"200",f.now()+1001));f.feed.receive(f.tick(5,"200",f.now()-STALE_MS-1));f.feed.receive(f.tick(6).replace("BTC-USD","FAKE-USD"));
 await flush();assert.equal(f.applied.length,1);f.feed.stop();
});
test("heartbeat does not refresh quote age, stale threshold enables recovery only after 10s",async()=>{
 const f=fixture();f.feed.receive(f.tick(1));await flush();assert.ok(!f.feed.staleSymbols().includes("BTC"));
 f.advance(STALE_MS);assert.ok(!f.feed.staleSymbols().includes("BTC"));
 f.advance(1);f.feed.receive(JSON.stringify({type:"heartbeat",product_id:"BTC-USD",time:new Date(f.now()).toISOString()}));assert.ok(f.feed.staleSymbols().includes("BTC"));f.feed.stop();
});
test("bounded queue disconnects loudly without coalescing accepted burst crossings",async()=>{
 let release!:()=>void;const blocked=new Promise<void>(r=>{release=r;});const applied:Tick[]=[];
 const f=fixture(async ticks=>{await blocked;applied.push(...ticks);},3);
 f.feed.step();for(let i=1;i<=4;i++)f.feed.receive(f.tick(i,String(100+i)));
 assert.equal(f.feed.pending,3);assert.equal(f.sockets[0].readyState,3);assert.ok(f.logs.some(s=>s.includes("overflow")));
 release();await flush();assert.deepEqual(applied.map(t=>t.micro),[101e6,102e6,103e6]);f.feed.stop();
});
test("zero-client serial burst settles transient TP crossing before reversal",async()=>{
 const room=freshRoom(),at=Date.now(),who={id:"feed",name:"Feed",email:"feed@test",admin:true};register(room,who);
 applyMarketTick(room,{BTC:{micro:100e6,at}},at);
 openPosition(room,who,"BTC","long",1000,2,"burst",at,{takeProfit:101e6});
 const f=fixture(async ticks=>{for(const t of ticks){if(room.quotes!.BTC?.at===t.at)delete room.quotes!.BTC;applyMarketTick(room,{BTC:{micro:t.micro,at:t.at}},t.at);}});
 f.feed.receive(f.tick(1,"102"));f.feed.receive(f.tick(2,"100"));await flush();
 assert.equal(room.members[0].positions?.length,0);assert.match(room.members[0].activity![0],/^Take-profit/);assert.equal(room.quotes!.BTC!.micro,100e6);f.feed.stop();
});
test("persistence failure retains bounded ticks for retry and missing products emit health",async()=>{
 let failed=true;const applied:Tick[]=[];const f=fixture(async ticks=>{if(failed)throw Error("offline");applied.push(...ticks);});
 f.feed.receive(f.tick(1));await flush();assert.equal(f.feed.pending,1);failed=false;f.feed.retryPending();await flush();assert.equal(applied.length,1);
 f.feed.receive(JSON.stringify({type:"subscriptions",channels:[{name:"ticker",product_ids:["BTC-USD"]}]}));assert.ok(f.logs.some(s=>s.includes("missing ticker products")));
 f.feed.stop();
});
test("all twenty healthy products suppress fallback until stale and fresh tick recovers",async()=>{
 const f=fixture();
 for(const s of SYMBOLS)f.feed.receive(f.tick(1).replace("BTC-USD",s+"-USD"));
 await flush();assert.deepEqual(f.feed.staleSymbols(),[]);
 f.advance(STALE_MS+1);assert.equal(f.feed.staleSymbols().length,20);
 for(const s of SYMBOLS)f.feed.receive(f.tick(2).replace("BTC-USD",s+"-USD"));
 await flush();assert.deepEqual(f.feed.staleSymbols(),[]);f.feed.stop();
});
test("transport stalls close and reconnect even without close event",()=>{
 const f=fixture();f.feed.step();f.advance(STALE_MS+1);f.feed.step();assert.equal(f.sockets[0].readyState,3);
 f.advance(500);f.feed.step();assert.equal(f.sockets.length,2);f.feed.stop();
});

test("startup has ten seconds of WebSocket-only grace, independent of reconnects",()=>{
 const f=fixture();assert.deepEqual(f.feed.staleSymbols(),[]);f.feed.step();f.advance(STALE_MS);assert.deepEqual(f.feed.staleSymbols(),[]);
 f.advance(1);assert.equal(f.feed.staleSymbols().length,20);f.feed.stop();
});
test("bounded clock skew accepts genuine near-future events, clamps cache time and rejects farther future",async()=>{
 const f=fixture();f.feed.receive(f.tick(1,"100",f.now()+25));f.feed.receive(f.tick(2,"101",f.now()+1001));await flush();assert.equal(f.applied.length,1);assert.equal(f.applied[0].at,f.now());f.feed.stop();
});

test("real epoch startup baseline gates fallback at elapsed 0, 9999 and 10001ms",()=>{
 const f=fixture();assert.ok(f.now()>1_000_000_000_000);
 assert.deepEqual(f.feed.staleSymbols(),[]);
 f.advance(9999);assert.deepEqual(f.feed.staleSymbols(),[]);
 f.advance(2);assert.equal(f.feed.staleSymbols().length,20);
 f.feed.stop();
});
