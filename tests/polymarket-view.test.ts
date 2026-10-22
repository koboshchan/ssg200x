import {test} from "node:test";
import assert from "node:assert/strict";
import {normalizePolyMarket,normalizePolyBook} from "../lib/polymarket-data";
import {outcomeFor,sideOf,quoteFrom,viewEvent,viewMarket,viewPortfolio,rememberEvents} from "../lib/polymarket-view";
import {freshRoom} from "../lib/poker";
const cond="0x"+"b".repeat(64);
const mkt=(now:number,labels='["No","Yes"]',ids='["222","111"]')=>normalizePolyMarket({id:"9",conditionId:cond,version:"v1",outcomes:labels,clobTokenIds:ids,outcomePrices:'["0.4","0.6"]',active:true,closed:false,acceptingOrders:true,image:"https://x.test/a.png",icon:"https://x.test/i.png"},now);
const bk=(now:number,asOf=now,fetched=now)=>({source:"stream" as const,...normalizePolyBook({asset_id:"111",market:cond,timestamp:String(asOf),hash:"h",bids:[{price:"0.59",size:"100"}],asks:[{price:"0.61",size:"100"}]},"111",fetched)});
test("side mapping follows labels, not order",()=>{
 const m=mkt(Date.now());assert.equal(outcomeFor(m,"yes").tokenId,"111");assert.equal(outcomeFor(m,"no").tokenId,"222");
 assert.equal(sideOf(m,"111"),"yes");assert.equal(sideOf(m,"222"),"no");
 const o=mkt(Date.now(),'["Over","Under"]','["1","2"]');assert.equal(outcomeFor(o,"yes").tokenId,"1");
});
test("quote is disabled when stale, disabled, or empty",()=>{
 const now=Date.now(),m=mkt(now);
 assert.equal(quoteFrom(bk(now),m,"buy",1000,true,now).tradable,true);
 assert.equal(quoteFrom(bk(now,now-11_000),m,"buy",1000,true,now).tradable,false);
 assert.equal(quoteFrom(bk(now,now,now-11_000),m,"buy",1000,true,now).tradable,false);
 assert.equal(quoteFrom(bk(now),m,"buy",1000,false,now).tradable,false);
 const empty={...bk(now),bids:[]};assert.equal(quoteFrom(empty,m,"sell",1_000_000,true,now).tradable,false);
 assert.equal(quoteFrom(bk(now),{...m,closed:true},"buy",1000,true,now).tradable,false);
});
test("quote numbers are exact and bounded",()=>{
 const now=Date.now(),q=quoteFrom(bk(now),mkt(now),"buy",1000,true,now);
 assert.equal(q.cents,1000);assert.ok(Number.isFinite(q.shares)&&q.shares>0&&q.price>=0.61&&q.price<1);
 assert.equal(quoteFrom(bk(now),mkt(now),"buy",100_000_000,true,now).tradable,false);
});
test("views expose no external URLs",()=>{
 const now=Date.now(),m=mkt(now),e=viewEvent({id:"1",slug:"s",title:"T",description:"d",image:"https://x.test/e.png",volume:1,volume24hr:1,markets:[m],tags:[]});
 const s=JSON.stringify([e,viewMarket(m)]);assert.ok(!/https?:\/\//.test(s),s);
});
test("portfolio: stale or capped positions are not live; settled rows rebuilt",async()=>{
 const now=Date.now(),r=freshRoom();
 const pos={id:"p",marketId:"9",conditionId:cond,version:"v1" as const,tokenId:"111",question:"Q",outcome:"Yes",image:null,slug:"s",shareMicros:5_000_000,cost:250,openedAt:now};
 const hist=[{id:"s1",requestId:"settle:9",marketId:"8",tokenId:"1",question:"Old",outcome:"Yes",action:"settle" as const,shareMicros:2_000_000,amount:200,cost:120,at:now},{id:"s2",requestId:"settle:7",marketId:"7",tokenId:"1",question:"Lost",outcome:"No",action:"settle" as const,shareMicros:1_000_000,amount:0,cost:50,at:now},{id:"s3",requestId:"settle:6",marketId:"6",tokenId:"1",question:"V",outcome:"Yes",action:"void" as const,shareMicros:1_000_000,amount:50,cost:50,at:now}];
 const v=await viewPortfolio(r,"u",1000,hist as never,[pos as never],now);
 const open=v.positions.find(p=>p.status==="open")!;assert.equal(open.valueCents,250);assert.equal(open.priceLive,false);
 assert.deepEqual(v.positions.filter(p=>p.status!=="open").map(p=>[p.status,p.valueCents,p.pnlCents]),[["won",200,80],["lost",0,-50],["void",50,0]]);
 assert.ok(!/https?:\/\//.test(JSON.stringify(v)));rememberEvents([]);
});
