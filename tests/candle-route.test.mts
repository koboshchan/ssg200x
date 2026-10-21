import test,{mock} from "node:test";
import assert from "node:assert/strict";
import {AppError} from "../lib/errors";
import {STOCK_SYMBOLS} from "../lib/stock-config";
import {freshRoom} from "../lib/poker";
import {marketSymbols} from "../lib/symbol-registry";
import {SYMBOLS} from "../lib/market-shared";

// Isolated authenticated fixture only. Production auth and storage are never changed.
// Exercise the actual route and candleRead; mock only identity/rate limit and DB I/O.
const room=freshRoom();
room.marketSymbols=marketSymbols();
const rows:Record<string,unknown>[]=[];
let reads=0,requestedLimit=0;
mock.module("../lib/api.ts",{namedExports:{endpoint:async(_request:Request,handler:(who:{id:string})=>Promise<unknown>)=>{
 try{return Response.json(await handler({id:"isolated-route-fixture"}));}
 catch(e){if(e instanceof AppError)return Response.json({error:e.message},{status:e.status});throw e;}
}}});
mock.module("../lib/store.ts",{namedExports:{rateLimit:async()=>{}}});
mock.module("../lib/db.ts",{namedExports:{readRoom:async()=>room,db:async()=>({collection:()=>({
 createIndex:async()=>{},
 find:(query:Record<string,any>)=>{
  reads++;
  return {sort:()=>({limit:(limit:number)=>{
   requestedLimit=limit;
   return {toArray:async()=>rows.filter(r=>r.symbol===query.symbol&&r.granularity===query.granularity&&Number(r.time)>=query.time.$gte&&Number(r.time)<=query.time.$lte).sort((a,b)=>Number(b.time)-Number(a.time)).slice(0,limit)};
  }})};
 }
})})}});
const {GET}=await import("../app/api/candles/route");
const from=1792451100000,to=1792469100000;
function request(symbol:string,extra=""){return new Request("https://example.test/api/candles?symbol="+symbol+"&granularity=1m&from="+from+"&to="+to+extra);}
for(const symbol of [...STOCK_SYMBOLS,...SYMBOLS]){
 test(symbol+" exact five-hour 1m range returns 200 when market has no bars",async()=>{
  rows.length=0;
  const response=await GET(request(symbol));
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  assert.deepEqual(await response.json(),{status:"cached",candles:[]});
  assert.equal(requestedLimit,1000);
 });
 test(symbol+" exact range reads existing bars chronologically without fetching history",async()=>{
  const bar=(time:number)=>({symbol,granularity:"1m",time,open:100,high:102,low:99,close:101,volume:0,source:STOCK_SYMBOLS.includes(symbol as never)?"alpaca-iex":"coinbase",quoteCurrency:"USD",firstAt:time,lastAt:time});
  const a=bar(from),b=bar(from+60000);
  rows.splice(0,rows.length,b,a,bar(from-60000),bar(to+60000),{...a,symbol:"UNKNOWN"});
  const response=await GET(request(symbol));
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  assert.deepEqual(await response.json(),{status:"cached",candles:[a,b]});
 });
}
for(const query of [
 "symbol=UNKNOWN&granularity=1m&from=0&to=1",
 "symbol=DOGE&granularity=1m&from=0&to=1",
 "symbol=NVDA&granularity=2m&from=0&to=1",
 "symbol=NVDA&granularity=__proto__&from=0&to=1",
 "symbol=NVDA&granularity=1m&from=-1&to=1",
 "symbol=NVDA&granularity=1m&from=2&to=1",
 "symbol=NVDA&granularity=1m&from=NaN&to=1",
 "symbol=NVDA&granularity=1m&from=0&to=Infinity",
 "symbol=NVDA&granularity=1m&from=0.5&to=1",
 "symbol=NVDA&granularity=1m&from=0&to=9007199254740992",
 "symbol=NVDA&granularity=1m&from=0&to=31622400001",
]){
 test("rejects malformed/unsupported query before storage "+query,async()=>{
  const before=reads,response=await GET(new Request("https://example.test/api/candles?"+query));
  assert.equal(response.status,400);assert.equal(reads,before);
 });
}
test("pagination stays capped at 1000 bars even with caller-supplied limit",async()=>{
 rows.length=0;
 for(let i=0;i<1002;i++)rows.push({symbol:"NVDA",granularity:"1m",time:from+i});
 const response=await GET(request("NVDA","&limit=99999999"));
 assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
 const body=await response.json();assert.equal(body.candles.length,1000);
 assert.equal(body.candles[0].time,from+2);assert.equal(body.candles[999].time,from+1001);
});

test("admin-added symbols load charts and removed default symbols are rejected",async()=>{
 room.marketSymbols!.crypto.push("ADA");
 room.marketSymbols!.stocks.push("GOOG");
 for(const symbol of ["ADA","GOOG"])assert.equal((await GET(request(symbol))).status,200);
 room.marketSymbols!.crypto=room.marketSymbols!.crypto.filter(s=>s!=="BTC");
 assert.equal((await GET(request("BTC"))).status,400);
});
