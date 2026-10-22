import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {freshRoom,assertRoom,register} from "../lib/poker";
import {applyPolymarketTrade,polyState,polyPortfolio,changePolymarketSettings,fillPolymarket,settlePolymarket,polyTradeSchema} from "../lib/polymarket";
import {normalizePolyMarket,normalizePolyBook,normalizePolyResolution,normalizePolyDataResolution,polyFixed,polyBook,polyDiscover,polyChart} from "../lib/polymarket-data";
import type {PolyTrade,PolyBook,PolyResolution} from "../lib/polymarket-types";
const who={id:"poly-user",name:"Private",email:"secret@test",admin:false},other={...who,id:"other"};
const condition="0x"+"a".repeat(64);
function market(now=Date.now()){return normalizePolyMarket({id:"123",conditionId:condition,version:"v1",outcomes:'["Yes","No"]',clobTokenIds:'["111","222"]',outcomePrices:'["0.6","0.4"]',active:true,closed:false,acceptingOrders:true,question:"Real question"},now);}
function book(now=Date.now()):PolyBook{return {source:"stream",...normalizePolyBook({asset_id:"111",market:condition,timestamp:String(now),hash:"abc",bids:[{price:"0.59",size:"1000000"}],asks:[{price:"0.6",size:"1000000"}]},"111",now)};}
function input(patch:Partial<PolyTrade>={}):PolyTrade{return{action:"buy",marketId:"123",tokenId:"111",amount:1000,limitPrice:.61,requestId:randomUUID(),requestAt:Date.now(),...patch};}
function resolution(payout=1_000_000):PolyResolution{return{marketId:"123",conditionId:condition,version:"v1",payouts:{"111":payout,"222":1e6-payout},source:"data-v2-final",asOf:Date.now(),kind:"settle"};}
test("v1/v2 normalize using explicit protocol discriminator, unknown versions never trade",()=>{
 const m=market();assert.equal(m.outcomes[0].tokenId,"111");
 const base={id:"1",active:true,closed:false,acceptingOrders:true,outcomes:'["A","B"]',clobTokenIds:'["1","2"]',positionIds:["3","4"]};
 assert.deepEqual(normalizePolyMarket({...base,version:"v2"}).outcomes.map(o=>o.tokenId),["3","4"]);
 assert.equal(normalizePolyMarket({...base,version:"v3"}).acceptingOrders,false);
 assert.equal(normalizePolyMarket({...base,version:"v2",positionIds:null}).acceptingOrders,false);
 assert.equal(normalizePolyMarket({...base,version:"v1",clobTokenIds:'["1","1"]'}).acceptingOrders,false);
 assert.equal(normalizePolyMarket({...base,image:"javascript:alert(1)"}).image,null);
});
test("decimal parser handles sub-cent odds exactly and rejects malformed/overflow values",()=>{
 assert.equal(polyFixed("0.0025"),2500);assert.equal(polyFixed("123.0000000"),123000000);
 for(const n of ["NaN","Infinity","-1","1e-7","0.0000001","999999999999999999"])assert.throws(()=>polyFixed(n));
});
test("books sort reversed CLOB sides; depth, slippage and all-or-none sell enforced",()=>{
 const b=normalizePolyBook({asset_id:"111",market:condition,timestamp:Date.now(),bids:[{price:"0.4",size:"2"},{price:"0.6",size:"3"}],asks:[{price:"0.9",size:"2"},{price:"0.7",size:"3"}]},"111");
 assert.deepEqual(b.bids.map(l=>l.price),[.6,.4]);assert.deepEqual(b.asks.map(l=>l.price),[.7,.9]);
 assert.throws(()=>fillPolymarket(b,"sell",6000000,.3),/liquidity/);
});
test("depth aggregate rounds debit upward, proceeds downward, rejects missing depth/limit",()=>{
 const b=book();b.asks=[{price:.61,size:1,priceMicros:610000,shareMicros:1000000},{price:.60,size:1,priceMicros:600000,shareMicros:1000000}].sort((a,b)=>a.price-b.price);
 const fill=fillPolymarket(b,"buy",100,.61);assert.equal(fill.amount,100);assert(fill.shareMicros>1e6);
 assert.throws(()=>fillPolymarket(b,"buy",200,.61),/liquidity/);
 assert.throws(()=>fillPolymarket(b,"buy",100,.60),/liquidity/);
 b.bids=[];assert.throws(()=>fillPolymarket(b,"sell",1e6,.5),/small/);
});
test("atomic trade conserves room with house counterparty; repeated same request and wrong payload/owner fenced",()=>{
 const r=freshRoom(),i=input();applyPolymarketTrade(r,who,i,market(),book());assertRoom(r);
 assert.equal(r.members[0].wallet,99000);assert.equal(r.house,1000);assert.equal(polyState(r).positions.length,1);
 applyPolymarketTrade(r,who,i,market(),book());assert.equal(r.members[0].wallet,99000);
 assert.throws(()=>applyPolymarketTrade(r,who,{...i,amount:2000},market(),book()),/different order/);
 assert.throws(()=>applyPolymarketTrade(r,other,i,market(),book()),/different order/);
 assert.equal(r.auditPending?.filter(a=>a.what==="polymarket.buy").length,1);
});
test("buy/sell roundtrip cannot produce rounding profit, cost basis preserved across partial sells",()=>{
 const r=freshRoom();applyPolymarketTrade(r,who,input(),market(),book());
 const before=polyState(r).positions[0],total=before.shareMicros,totalCost=before.cost;
 const b=book();b.bids=b.asks;
 applyPolymarketTrade(r,who,input({action:"sell",amount:Math.floor(total/2),limitPrice:.59}),market(),b);
 const remaining=polyState(r).positions[0],h=polyState(r).history[who.id][0];
 assert.equal(remaining.cost+h.cost,totalCost);
 applyPolymarketTrade(r,who,input({action:"sell",amount:remaining.shareMicros,limitPrice:.59}),market(),b);
 assert(polyPortfolio(r,who).wallet<=100000);assert.equal(polyState(r).positions.length,0);assertRoom(r);
});
test("strict stale/future quote, market, mismatched token, closed status, limit, admin disable and expired requests reject",()=>{
 for(const patch of [{asOf:Date.now()-10001},{fetchedAt:Date.now()-10001},{asOf:Date.now()+5000},{conditionId:"wrong"},{tokenId:"222"}]){
  const r=freshRoom();assert.throws(()=>applyPolymarketTrade(r,who,input(),market(),{...book(),...patch}));
 }
 assert.throws(()=>applyPolymarketTrade(freshRoom(),who,input(),{...market(),closed:true},book()),/accepting/);
 assert.throws(()=>applyPolymarketTrade(freshRoom(),who,input(),{...market(),asOf:Date.now()-11000},book()),/stale/);
 assert.throws(()=>applyPolymarketTrade(freshRoom(),who,input({requestAt:Date.now()-130000}),market(),book()),/expired/);
 const r=freshRoom();assert.throws(()=>changePolymarketSettings(r,who,{enabled:false,maxTrade:100}),/Administrator/);
 changePolymarketSettings(r,{...who,admin:true},{enabled:true,maxTrade:500});
 assert.throws(()=>applyPolymarketTrade(r,who,input(),market(),book()),/limit/);
 changePolymarketSettings(r,{...who,admin:true},{enabled:false,maxTrade:100000});
 assert.throws(()=>applyPolymarketTrade(r,who,input(),market(),book()),/disabled/);
});
test("portfolio does not expose other user IDs, positions/history or email",()=>{
 const r=freshRoom();applyPolymarketTrade(r,who,input(),market(),book());register(r,other);
 const own=polyPortfolio(r,who),stranger=polyPortfolio(r,other);assert.equal(stranger.positions.length,0);assert.equal(stranger.history.length,0);
 assert(!JSON.stringify(own).includes(who.id));assert(!JSON.stringify(own).includes(who.email));
 r.members[0].accessRevoked=true;assert.throws(()=>polyPortfolio(r,who),/revoked/);
});
test("winning/losing/split settlement is once-only, audited, survives disabled state and conserves cents",()=>{
 for(const payout of [1000000,0,500000]){
  const r=freshRoom();applyPolymarketTrade(r,who,input(),market(),book());const p=structuredClone(polyState(r).positions[0]);
  changePolymarketSettings(r,{...who,admin:true},{enabled:false,maxTrade:1});
  assert.equal(settlePolymarket(r,resolution(payout)),true);assertRoom(r);
  const expected=Number(BigInt(p.shareMicros)*BigInt(payout)/10000000000n);
  assert.equal(r.members[0].wallet,99000+expected);assert.equal(polyState(r).positions.length,0);
  assert.equal(settlePolymarket(r,resolution(payout)),false);assert.equal(polyState(r).history[who.id].length,2);
 }
});
test("resolution requires matching final evidence, not closed date, price=1, pending dispute or malformed payout",()=>{
 const m={...market(),closed:true,outcomes:market().outcomes.map((o,i)=>({...o,price:i?0:1}))};
 const clob={closed:true,condition_id:condition,tokens:[{token_id:"111",winner:true,price:1},{token_id:"222",winner:false,price:0}]};
 assert(normalizePolyResolution(m,clob));assert.equal(normalizePolyResolution({...m,closed:false},clob),null);
 assert.equal(normalizePolyResolution(m,{...clob,tokens:clob.tokens.map(t=>({...t,winner:false}))}),null);
 assert.equal(normalizePolyResolution(m,{...clob,condition_id:"bad"}),null);
 const row={condition_id:condition,status:"resolved",payouts:[500000,500000],extended_review:false};
 assert.equal(normalizePolyDataResolution(m,{data:[row]})?.kind,"settle");
 for(const patch of [{status:"disputed"},{payouts:[1000000,1000000]},{payouts:[0.5,999999.5]},{condition_id:"bad"},{extended_review:true}]){
  assert.equal(normalizePolyDataResolution(m,{data:[{...row,...patch}]}),null);
 }
 const r=freshRoom();applyPolymarketTrade(r,who,input(),market(),book());
 assert.throws(()=>settlePolymarket(r,{...resolution(),conditionId:"bad"}),/identity/);
 assert.throws(()=>settlePolymarket(r,{...resolution(),asOf:Date.now()-61000}),/expired/);
});
test("trade schema rejects unknown keys, noninteger cents/shares, invalid limit and UUID",()=>{
 for(const patch of [{amount:1.5},{amount:0},{amount:Infinity},{limitPrice:1},{limitPrice:-1},{requestId:"x"},{hacked:true}])assert.equal(polyTradeSchema.safeParse({...input(),...patch}).success,false);
});
test("public data singleflight deduplicates, preserves cache copies and encodes search instead of interpolating URLs",async()=>{
 const original=globalThis.fetch;let calls=0;const paths:string[]=[];
 globalThis.fetch=async(url)=>{calls++;paths.push(String(url));const u=new URL(String(url));
  if(u.pathname==="/book")return Response.json({asset_id:u.searchParams.get("token_id"),market:condition,timestamp:Date.now(),bids:[],asks:[{price:"0.5",size:"1"}]});
  if(u.pathname==="/prices-history")return Response.json({history:[{t:1700000000,p:.5},{t:-1,p:2}]});
  return Response.json({events:[],pagination:{hasMore:false}});
 };
 try{
  await Promise.all(Array.from({length:12},()=>polyDiscover("dedup-stream-grid")));assert.equal(calls,1);
  await polyDiscover("a&url=https://evil.invalid");assert(paths[1].includes("q=a%26url%3Dhttps%3A%2F%2Fevil.invalid"));
  assert.deepEqual((await polyChart("999777")).history,[{t:1700000000,p:.5}]);
  await assert.rejects(()=>polyBook("../evil"));
 }finally{globalThis.fetch=original;}
});
test("void refunds the original position cost, never share payout",()=>{
 const r=freshRoom();applyPolymarketTrade(r,who,input(),market(),book());const cost=r.polymarket!.positions[0].cost,wallet=r.members[0].wallet;
 settlePolymarket(r,{...resolution(),kind:"void"});
 assert.equal(r.members[0].wallet,wallet+cost);assert.equal(r.polymarket!.history[who.id][0].action,"void");assert.equal(r.polymarket!.history[who.id][0].amount,cost);
});

test("REST-shaped book cannot execute even if timestamp is fresh",()=>{const b=book();delete b.source;assert.throws(()=>applyPolymarketTrade(freshRoom(),who,input(),market(),b),/stream/);});

test('book adapter reads only authenticated local stream bridge, rejects REST-shaped/absent stream responses',async()=>{
 const original=globalThis.fetch;const paths:string[]=[];let mode='valid';
 globalThis.fetch=async(url,init)=>{paths.push(String(url));assert.equal(init?.method,'POST');assert.ok(new Headers(init?.headers).has('x-internal-live-secret'));const payload=JSON.parse(String(init?.body));return mode==='missing'?Response.json({error:'waiting'},{status:409}):Response.json({asset_id:payload.tokenId,market:condition,timestamp:Date.now(),bids:[],asks:[{price:'0.5',size:'1'}],...(mode==='valid'?{source:'stream'}:{})});};
 try{assert.equal((await polyBook('7654321')).source,'stream');assert.ok(paths[0].startsWith('http://127.0.0.1:'));mode='rest';await assert.rejects(()=>polyBook('7654321'),/stream/);mode='missing';await assert.rejects(()=>polyBook('7654321'),/stream/);}
 finally{globalThis.fetch=original;}
});
