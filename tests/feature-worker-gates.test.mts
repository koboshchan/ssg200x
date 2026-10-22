import test,{mock,beforeEach,afterEach} from "node:test";
import assert from "node:assert/strict";

// Real price worker, feature-settings cache, ExchangeFeed, StockRuntime,
// ForexIsolation and OandaStream. Only persistence and network I/O are fakes.
// No provider socket, request or Mongo connection can escape this process.
type Flags={stocks:boolean;forex:boolean;cryptoPerps:boolean;cryptoSpot:boolean};
const disabled:Flags={stocks:false,forex:false,cryptoPerps:false,cryptoSpot:false};
let configured={...disabled},now=Date.parse("2026-10-22T15:00:00Z");
let initialRead:Promise<void>|undefined;
const room={marketSymbols:{crypto:["BTC"],stocks:["AAPL"],forex:["EUR/USD"],delisted:[],revision:0},members:[],quotes:{},forexQuotes:{}};
const requests:string[]=[],sockets:FakeSocket[]=[],streams:{signal:AbortSignal;cancelled:boolean}[]=[];
const locks=new Map<string,{owner:string;until:number}>();
const featureCollection={findOne:async()=>{await initialRead;return {features:{...configured}};}};
const workerCollection={updateOne:async(query:any,update:any)=>{
 const old=locks.get(query._id);
 if(update.$setOnInsert){if(!old)locks.set(query._id,{...update.$setOnInsert});return {matchedCount:old?1:0};}
 if(query.$or&&old&&old.owner!==query.$or[0].owner&&old.until>now)return {matchedCount:0};
 if(query.owner&&old?.owner!==query.owner)return {matchedCount:0};
 locks.set(query._id,{...old,...update.$set});return {matchedCount:1};
}};
mock.module("../lib/db.ts",{namedExports:{
 db:async()=>({collection:(name:string)=>{if(name==="featureFlags")return featureCollection;if(name==="workers")return workerCollection;throw new Error("Unexpected collection "+name);}}),
 readRoom:async()=>room
}});
mock.module("../lib/store.ts",{namedExports:{
 mutate:async(fn:(value:typeof room)=>unknown)=>{fn(room);},
 mutateStockPublication:async(_owner:string,fn:(value:typeof room)=>unknown)=>{fn(room);}
}});
mock.module("../lib/candles.ts",{namedExports:{candleUpdate:async()=>{}}});
mock.module("../lib/market-tick.ts",{namedExports:{applyMarketTick:()=>{}}});
mock.module("../lib/stock-publication.ts",{namedExports:{applyStockPublication:(_room:unknown,current:()=>unknown)=>{current();}}});
mock.module("../lib/forex-config.ts",{namedExports:{
 forexMonotonic:()=>now,forexClockDomain:"worker-gates-fixture",forexLiveConfigured:()=>true
}});

class FakeSocket {
 readyState=1;
 onopen:(()=>void)|null=null;onmessage:((e:{data:string})=>void)|null=null;
 onerror:(()=>void)|null=null;onclose:(()=>void)|null=null;
 sent:string[]=[];closed=false;
 constructor(readonly url:string){sockets.push(this);}
 send(data:string){this.sent.push(data);}
 close(){this.closed=true;this.readyState=3;}
}
const settingsSlot=Symbol.for("ssg.featureSettings");
const globals=globalThis as any;
const {startPriceWorker}=await import("../lib/prices.ts");
let worker:ReturnType<typeof startPriceWorker>|undefined;
let previousEnv:NodeJS.ProcessEnv;
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function drain(){for(let i=0;i<8;i++)await settle();}
async function boot(){
 worker=startPriceWorker();
 // Advance explicitly, never race the real 100ms worker timer.
 clearInterval(worker.timer);
 return worker;
}
async function patch(flags:Partial<Flags>){
 Object.assign(configured,flags);await globals[settingsSlot].refresh();await drain();
}
async function step(){await worker!.runOnce();await drain();}
function count(provider:"stocks"|"crypto"|"forex"){
 return provider==="forex"?streams.length:sockets.filter(s=>provider==="stocks"?s.url.includes("alpaca"):s.url.includes("coinbase")).length;
}
function active(provider:"stocks"|"crypto"){
 return sockets.filter(s=>!s.closed&&(provider==="stocks"?s.url.includes("alpaca"):s.url.includes("coinbase")));
}
beforeEach(()=>{
 configured={...disabled};initialRead=undefined;now=Date.parse("2026-10-22T15:00:00Z");
 requests.length=sockets.length=streams.length=0;locks.clear();
 mock.method(Date,"now",()=>now);
 previousEnv={...process.env};
 for(const [key,value]of Object.entries({ALPACA_KEY_ID:"fixture",ALPACA_SECRET:"fixture",OANDA_API_TOKEN:"fixture",OANDA_ACCOUNT_ID:"fixture",FX_STREAM_ENABLED:"true",FX_STREAM_ENV:"test-worker-gates",SSG_FEATURES_FORCE_OFF:"",OANDA_OBSERVATION_FILE:""}))process.env[key]=value;
 mock.property(globalThis,"WebSocket",FakeSocket);
 mock.method(globalThis,"fetch",async(input:any,init:any)=>{
  const url=String(input);requests.push(url);
  if(url.startsWith("https://paper-api.alpaca.markets/v2/clock"))return Response.json({timestamp:new Date(now).toISOString(),is_open:true,next_open:"2026-10-23T13:30:00Z",next_close:"2026-10-22T20:00:00Z"});
  if(url.startsWith("https://paper-api.alpaca.markets/v2/calendar"))return Response.json([{date:"2026-10-22",open:"09:30",close:"16:00"}]);
  if(url.startsWith("https://stream-fxpractice.oanda.com/")){
   const entry={signal:init.signal as AbortSignal,cancelled:false};streams.push(entry);
   const body=new ReadableStream<Uint8Array>({
    start(controller){controller.enqueue(new TextEncoder().encode(JSON.stringify({type:"HEARTBEAT",time:new Date(now).toISOString()})+"\n"));},
    cancel(){entry.cancelled=true;}
   });
   return new Response(body);
  }
  throw new Error("Unexpected network request "+url);
 });
 // Keep intentional disconnect diagnostics out of test output.
 mock.method(console,"warn",()=>{});mock.method(console,"info",()=>{});
});
afterEach(async()=>{
 if(worker){worker.stop();process.removeListener("SIGTERM",worker.stop);process.removeListener("SIGINT",worker.stop);worker=undefined;}
 globals[settingsSlot]?.stop();delete globals[settingsSlot];
 await drain();
 assert.ok(streams.every(s=>s.signal.aborted&&s.cancelled),"all fake FX readers cleaned up");
 assert.ok(sockets.every(s=>s.closed),"all fake provider sockets closed");
 for(const key of Object.keys(process.env))if(!(key in previousEnv))delete process.env[key];
 Object.assign(process.env,previousEnv);
 mock.restoreAll();
});

test("initial settings read is awaited before any provider connection, even with credentials present",async()=>{
 configured={stocks:true,forex:true,cryptoPerps:true,cryptoSpot:true};
 let release!:()=>void;initialRead=new Promise<void>(resolve=>{release=resolve;});
 await boot();await drain();
 assert.equal(requests.length,0);assert.equal(sockets.length,0);
 release();await worker!.ready;await step();
 assert.equal(count("stocks"),1);assert.equal(count("forex"),1);assert.equal(count("crypto"),1);
});

test("all features disabled at boot produce zero provider HTTP or websocket connects across repeated steps",async()=>{
 await boot();await worker!.ready;
 for(let i=0;i<4;i++){now+=2000;await step();}
 assert.deepEqual(requests,[]);assert.deepEqual(sockets,[]);assert.deepEqual(streams,[]);
 assert.ok(![...locks.keys()].some(key=>key.startsWith("oanda-feed:")),"disabled FX never claims its provider lease");
});

test("stocks enable after disabled boot, close immediately on disable, and reconnect on re-enable",async()=>{
 await boot();await worker!.ready;
 await patch({stocks:true});now+=40000;await step();
 assert.equal(count("stocks"),1);assert.equal(active("stocks").length,1);
 assert.equal(requests.filter(url=>url.includes("alpaca")).length,2);
 assert.equal(count("crypto"),0);assert.equal(count("forex"),0);
 await patch({stocks:false});
 assert.equal(active("stocks").length,0,"flag listener closes existing socket without waiting for worker timer");
 const before=requests.length;
 now+=10000;await step();assert.equal(requests.length,before);assert.equal(count("stocks"),1);
 await patch({stocks:true});now+=40000;await step();
 assert.equal(count("stocks"),2);assert.equal(active("stocks").length,1);
});

test("forex enable after disabled boot, abort and cancel reader on disable, then reconnect on re-enable",async()=>{
 await boot();await worker!.ready;
 await patch({forex:true});await step();
 assert.equal(count("forex"),1);assert.equal(streams[0].signal.aborted,false);
 assert.equal(count("stocks"),0);assert.equal(count("crypto"),0);
 await patch({forex:false});
 assert.equal(streams[0].signal.aborted,true);assert.equal(streams[0].cancelled,true);
 now+=2000;await step();assert.equal(count("forex"),1);
 await patch({forex:true});await step();
 assert.equal(count("forex"),2);assert.equal(streams[1].signal.aborted,false);
});

test("crypto shares a feed for spot/perps, stops only when both flags are off, and reconnects after enable",async()=>{
 await boot();await worker!.ready;
 await patch({cryptoSpot:true});await step();
 assert.equal(count("crypto"),1);assert.equal(active("crypto").length,1);
 await patch({cryptoPerps:true,cryptoSpot:false});await step();
 assert.equal(count("crypto"),1,"perps keeps the shared socket alive");
 await patch({cryptoSpot:true,cryptoPerps:false});await step();
 assert.equal(count("crypto"),1,"spot keeps the shared socket alive");
 await patch({cryptoSpot:false});
 assert.equal(active("crypto").length,0,"runtime disable closes immediately");
 now+=2000;await step();assert.equal(count("crypto"),1);
 await patch({cryptoPerps:true});await step();
 assert.equal(count("crypto"),2);assert.equal(active("crypto").length,1);
 assert.equal(count("stocks"),0);assert.equal(count("forex"),0);
});

// @ts-expect-error direct runtime module, no frontend/network replacement
import {attachMarketFeatureSubscriptions} from '../runtime/market-feature-subscriptions.mjs';
// @ts-expect-error direct runtime module
import {createPolymarketStream,attachPolymarketPresence} from '../runtime/polymarket-stream.mjs';
class Client {
 id:string;connected=true;data:any;handlers=new Map<string,Function[]>();events:any[]=[];
 constructor(id:string,route='/markets'){this.id=id;this.data={marketRoute:route,expires:now+1000000};}
 on(event:string,fn:Function){this.handlers.set(event,[...(this.handlers.get(event)??[]),fn]);}
 emit(...args:any[]){this.events.push(args);}
 async receive(event:string,...args:any[]){for(const fn of this.handlers.get(event)??[])await fn(...args);}
}
class PolyWire extends EventTarget {
 readyState=0;closed=false;frames:string[]=[];
 send(data:string){this.frames.push(data);}
 open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
 close(){this.closed=true;this.readyState=3;this.dispatchEvent(new Event('close'));}
}
test('one process toggles real Alpaca/OANDA/Polymarket runtimes AND current client subscriptions off/on',async()=>{
 await boot();await worker!.ready;
 const settings=globals[settingsSlot],wires:PolyWire[]=[];
 const poly=createPolymarketStream({enabled:()=>settings.enabled('polymarket'),now:()=>now,graceMs:0,connect:()=>{const w=new PolyWire();wires.push(w);return w;}});
 const off=settings.subscribe(()=>poly.syncEnabled());
 const stock=new Client('stocks'),fxClient=new Client('fx'),pm=new Client('pm','/polymarket');
 for(const s of [stock,fxClient]){
  const subscriptions=attachMarketFeatureSubscriptions(s,{settings,now:()=>now});
  subscriptions.updateSymbols(room.marketSymbols);
 }
 attachPolymarketPresence(pm,{settings,now:()=>now,checkSession:async()=>{},resolveMarket:async()=>({tokens:['11','12']}),stream:{...poly,setViewer(viewer:string,id:string|null,tokens:string[]){poly.setViewer(viewer,id,tokens);pm.data.polyMarketId=id;}}});
 try{
  await patch({stocks:true,forex:true});now+=40000;await step();
  await stock.receive('market:subscribe','AAPL');
  await stock.receive('candles:subscribe',{symbol:'AAPL',granularity:'1m'});
  await fxClient.receive('market:subscribe','EUR/USD');
  await fxClient.receive('candles:subscribe',{symbol:'EUR/USD',granularity:'1m'});
  await pm.receive('polymarket:watch','1');wires[0].open();
  assert.equal(active('stocks').length,1);assert.equal(streams[0].signal.aborted,false);assert.equal(poly.diagnostics().connections,1);
  assert.equal(stock.data.marketSymbol,'AAPL');assert.equal(stock.data.chart.symbol,'AAPL');
  assert.equal(fxClient.data.marketSymbol,'EUR/USD');assert.equal(fxClient.data.chart.symbol,'EUR/USD');assert.equal(pm.data.polyMarketId,'1');

  Object.assign(configured,{polymarket:false});await patch({stocks:false,forex:false});
  assert.equal(active('stocks').length,0);assert.equal(streams[0].signal.aborted,true);assert.equal(streams[0].cancelled,true);assert.equal(wires[0].closed,true);
  for(const s of [stock,fxClient]){assert.equal(s.data.marketSymbol,undefined);assert.equal(s.data.chart,undefined);}
  assert.equal(pm.data.polyMarketId,null);assert.equal(poly.diagnostics().subscribed.length,0);
  // No client re-emission, process replacement, or new worker on re-enable.
  Object.assign(configured,{polymarket:true});await patch({stocks:true,forex:true});now+=40000;await step();wires[1].open();
  assert.equal(count('stocks'),2);assert.equal(count('forex'),2);assert.equal(poly.diagnostics().connections,1);
  assert.equal(stock.data.marketSymbol,'AAPL');assert.equal(stock.data.chart.symbol,'AAPL');
  assert.equal(fxClient.data.marketSymbol,'EUR/USD');assert.equal(fxClient.data.chart.symbol,'EUR/USD');assert.equal(pm.data.polyMarketId,'1');
 }finally{
  for(const s of [stock,fxClient,pm]){s.connected=false;await s.receive('disconnect');}
  off();poly.stop();assert.ok(wires.every(w=>w.closed));
 }
});
