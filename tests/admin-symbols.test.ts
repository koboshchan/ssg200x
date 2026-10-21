import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register} from "../lib/poker";
import {adminSymbolSnapshot,changeMarketSymbol,validateProviderSymbol,symbolImpact} from "../lib/admin-symbols";
import {marketSymbols,activeSymbol,delistedSymbol} from "../lib/symbol-registry";
import {spot,redeemLegacyHolding,closePosition} from "../lib/finance";
import {applyMarketTick} from "../lib/market-tick";
import {AlpacaIexFeed,type StockSocket} from "../lib/stock-feed";
import {ExchangeFeed} from "../lib/exchange-feed";
const admin={id:"a",name:"Admin",email:"a@example.com",admin:true},user={id:"u",name:"User",email:"u@example.com",admin:false};
test("seed includes six crypto and seven equities; ordinary users cannot read or mutate",()=>{
 const r=freshRoom();assert.equal(marketSymbols(r).crypto.length,6);assert.equal(marketSymbols(r).stocks.length,7);
 assert.throws(()=>adminSymbolSnapshot(r,user),/Administrator/);
 assert.throws(()=>changeMarketSymbol(r,user,{action:"add",kind:"stocks",symbol:"GOOG",expectedVersion:0}),/Administrator/);
});
test("CAS registry revisions prevent lost edits; duplicate, malformed and unconfirmed changes fail",()=>{
 const r=freshRoom();changeMarketSymbol(r,admin,{action:"add",kind:"stocks",symbol:"GOOG",expectedVersion:0});
 assert(activeSymbol("GOOG",r));assert.equal(marketSymbols(r).revision,1);
 assert.throws(()=>changeMarketSymbol(r,admin,{action:"add",kind:"crypto",symbol:"ADA",expectedVersion:0}),/changed/);
 assert.throws(()=>changeMarketSymbol(r,admin,{action:"add",kind:"crypto",symbol:"GOOG",expectedVersion:1}),/already/);
 assert.throws(()=>changeMarketSymbol(r,admin,{action:"add",kind:"crypto",symbol:"../../x",expectedVersion:1}),/uppercase/);
 assert.throws(()=>changeMarketSymbol(r,admin,{action:"remove",kind:"stocks",symbol:"GOOG",expectedVersion:1}),/Confirm/);
});
test("delisting preserves holdings, cached quote and positions, forbids new trades and supports cached manual settlement",()=>{
 const r=freshRoom(),m=register(r,user),now=Date.now();r.quotes={BTC:{micro:100_000_000,at:now}};
 m.holdings=[{symbol:"BTC",units:100000000,cost:10000}];m.positions=[{id:"p",symbol:"BTC",side:"long",entry:100_000_000,margin:1000,leverage:2,opened:now}];
 assert.deepEqual(symbolImpact(r,"BTC"),{holdings:1,positions:1,accounts:1});
 changeMarketSymbol(r,admin,{action:"remove",kind:"crypto",symbol:"BTC",expectedVersion:0,confirmed:true});
 assert(delistedSymbol("BTC",r));assert.equal(m.holdings.length,1);assert.equal(m.positions.length,1);
 assert.throws(()=>spot(r,user,"BTC","buy",100),/delisted/);
 applyMarketTick(r,{BTC:{micro:1,at:now+1}},now+1);assert.equal(r.quotes.BTC!.micro,100_000_000);assert.equal(m.positions.length,1);
 redeemLegacyHolding(r,user,"BTC",now);closePosition(r,user,"p",now);assert.equal(m.holdings.length,0);assert.equal(m.positions.length,0);
});
test("new symbols accept quotes; percentage baseline uses first validated quote of UTC day",()=>{
 const r=freshRoom(),now=Date.now();changeMarketSymbol(r,admin,{action:"add",kind:"crypto",symbol:"ADA",expectedVersion:0});
 applyMarketTick(r,{ADA:{micro:1000000,at:now}},now);applyMarketTick(r,{ADA:{micro:1100000,at:now+1}},now+1);
 assert.equal(r.marketDay?.ADA.open,1000000);assert.equal(r.quotes?.ADA?.micro,1100000);
});
test("provider validation checks exact USD product and active tradable equity; errors fail closed",async()=>{
 const response=(value:unknown,status=200)=>async()=>new Response(JSON.stringify(value),{status});
 await validateProviderSymbol("crypto","ADA",response({id:"ADA-USD",base_currency:"ADA",quote_currency:"USD",status:"online",trading_disabled:false}));
 await assert.rejects(()=>validateProviderSymbol("crypto","ADA",response({id:"ADA-USDT",status:"online"})),/unavailable/);
 await assert.rejects(()=>validateProviderSymbol("crypto","ADA",response({},404)),/does not list/);
 await assert.rejects(()=>validateProviderSymbol("crypto","ADA",response({},429)),/unavailable/);
 const env={ALPACA_KEY_ID:"fixture",ALPACA_SECRET:"fixture"};
 await validateProviderSymbol("stocks","GOOG",response({symbol:"GOOG",class:"us_equity",status:"active",tradable:true}),env);
 await assert.rejects(()=>validateProviderSymbol("stocks","GOOG",response({symbol:"GOOG",class:"us_equity",status:"active",tradable:false}),env),/tradable/);
});
test("Alpaca updates shared socket subscriptions without creating another connection",()=>{
 const sent:Record<string,unknown>[]=[],socket:StockSocket={send:s=>sent.push(JSON.parse(s)),close(){},onopen:null,onclose:null,onerror:null,onmessage:null};
 let symbols=["AAPL"],connections=0;
 const f=new AlpacaIexFeed({symbols:()=>symbols,env:{ALPACA_KEY_ID:"f",ALPACA_SECRET:"f"},permitted:()=>true,isLeader:()=>true,socket:()=>{connections++;return socket;},now:Date.now,onState(){},onTick(){}});
 f.start();socket.onopen?.();socket.onmessage?.({data:JSON.stringify([{T:"success",msg:"authenticated"}])});
 symbols=["GOOG"];f.sync();assert.equal(connections,1);
 assert.deepEqual(sent.slice(-2),[{action:"unsubscribe",trades:["AAPL"],quotes:["AAPL"]},{action:"subscribe",trades:["GOOG"],quotes:["GOOG"]}]);f.stop();
});
test("Coinbase updates shared socket subscriptions and ignores removed products",()=>{
 let symbols=["BTC"],connections=0;const sent:Record<string,unknown>[]=[];
 const socket={readyState:1,send:(s:string)=>sent.push(JSON.parse(s)),close(){},onopen:null,onmessage:null,onerror:null,onclose:null} as unknown as WebSocket;
 const f=new ExchangeFeed({symbols:()=>symbols,socket:()=>{connections++;return socket;},apply:async()=>{},now:()=>1000});
 f.step();socket.onopen?.({} as Event);symbols=["ADA"];f.step();
 assert.equal(connections,1);assert.deepEqual(sent.slice(-2),[{type:"unsubscribe",product_ids:["BTC-USD"],channels:["ticker","heartbeat"]},{type:"subscribe",product_ids:["ADA-USD"],channels:["ticker","heartbeat"]}]);f.stop();
});
test("stock boundary allows the 30th active stock, rejects the 31st atomically, removal frees a slot",()=>{
 const r=freshRoom();r.marketSymbols={crypto:["BTC"],stocks:Array.from({length:29},(_,i)=>"S"+i),delisted:[],revision:0};
 changeMarketSymbol(r,admin,{action:"add",kind:"stocks",symbol:"LAST",expectedVersion:0});
 assert.equal(marketSymbols(r).stocks.length,30);
 const before=structuredClone(r);
 assert.throws(()=>changeMarketSymbol(r,admin,{action:"add",kind:"stocks",symbol:"EXTRA",expectedVersion:1}),/30 active stocks/);
 assert.deepEqual(r,before);
 changeMarketSymbol(r,admin,{action:"remove",kind:"stocks",symbol:"LAST",expectedVersion:1,confirmed:true});
 changeMarketSymbol(r,admin,{action:"add",kind:"stocks",symbol:"EXTRA",expectedVersion:2});
 assert.equal(marketSymbols(r).stocks.length,30);
});
test("crypto has no symbol-count cap, retains sane validation and shares one upstream socket",()=>{
 const r=freshRoom();r.marketSymbols={crypto:Array.from({length:150},(_,i)=>"C"+i),stocks:Array.from({length:30},(_,i)=>"S"+i),delisted:[],revision:0};
 changeMarketSymbol(r,admin,{action:"add",kind:"crypto",symbol:"ADA",expectedVersion:0});
 assert.equal(marketSymbols(r).crypto.length,151);
 assert.throws(()=>changeMarketSymbol(r,admin,{action:"add",kind:"crypto",symbol:"THISISWAYTOOLONGX",expectedVersion:1}),/uppercase/);
 let symbols=marketSymbols(r).crypto,connections=0;const sent:any[]=[];
 const socket={readyState:1,send:(s:string)=>sent.push(JSON.parse(s)),close(){},onopen:null,onmessage:null,onerror:null,onclose:null} as unknown as WebSocket;
 const f=new ExchangeFeed({symbols:()=>symbols,socket:()=>{connections++;return socket;},apply:async()=>{},now:()=>1000});
 f.step();socket.onopen?.({} as Event);
 assert.equal(sent[0].product_ids.length,151);
 symbols=[...symbols,"DOGE"];f.step();
 assert.equal(connections,1);assert.deepEqual(sent.at(-1).product_ids,["DOGE-USD"]);f.stop();
});
