import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
// @ts-expect-error server runtime is tested directly
import {createPolymarketPublic,publicFamily,retryAfterMs} from '../runtime/polymarket-public.mjs';
const gamma='https://gamma-api.polymarket.com',clob='https://clob.polymarket.com';
function setup(extra:any={}){let at=1700000000000;const waits:number[]=[],calls:any[]=[];const service=createPolymarketPublic({now:()=>at,sleep:async(ms:number)=>{waits.push(ms);at+=ms;},random:()=>0,spacingMs:0,fetcher:async(path:string,init:any)=>{calls.push({path,init,at});return Response.json({events:[]});},...extra});return{service,calls,waits,time:(ms:number)=>at+=ms,now:()=>at};}
test('strict public GET allowlist excludes credentials, private APIs, arbitrary hosts and redirects',async()=>{
 for(const path of [gamma+'/markets',gamma+'/public-search?q=x',clob+'/prices-history?market=1','https://data-api.polymarket.com/v2/resolutions?condition=x'])assert.ok(publicFamily(path));
 for(const path of [gamma+'/auth/api-key',clob+'/order',clob+'/data/orders','https://evil.invalid/markets','https://secret@clob.polymarket.com/prices-history',gamma+'/markets#secret'])assert.throws(()=>publicFamily(path));
 const s=setup();await s.service.get(gamma+'/markets');const init=s.calls[0].init;assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.deepEqual(init.headers,{Accept:'application/json'});assert.equal(init.body,undefined);
});
test('shared cache and concurrent singleflight keep isolated copies, fresh calls cannot duplicate in-flight work',async()=>{
 let calls=0,release:any;const s=setup({fetcher:async()=>{calls++;await new Promise(r=>release=r);return Response.json({events:[]});}});
 const pending=Array.from({length:30},()=>s.service.get(gamma+'/markets',10000,true));await Promise.resolve();assert.equal(calls,1);release();const values=await Promise.all(pending);values[0].events.push(1);assert.deepEqual(values[1].events,[]);assert.deepEqual((await s.service.get(gamma+'/markets')).events,[]);assert.equal(calls,1);
});
test('family and aggregate sliding budgets include fresh requests and retries, reset only after window',async()=>{
 const s=setup({budgets:{all:3,markets:2,search:3}});await s.service.get(gamma+'/markets/1');await s.service.get(gamma+'/markets/2');await assert.rejects(()=>s.service.get(gamma+'/markets/3'));await s.service.get(gamma+'/public-search?q=a');await assert.rejects(()=>s.service.get(gamma+'/public-search?q=b'));assert.equal(s.calls.length,3);s.time(10001);await s.service.get(gamma+'/markets/4');assert.equal(s.calls.length,4);
});
test('429 honors Retry-After seconds and dates plus jitter; retry count is capped',async()=>{
 let at=1700000000000,calls=0;const waits:number[]=[];const s=createPolymarketPublic({now:()=>at,random:()=>.5,spacingMs:0,sleep:async(ms:number)=>{waits.push(ms);at+=ms;},fetcher:async()=>{calls++;return calls<3?new Response('',{status:429,headers:{'Retry-After':calls===1?'1':new Date(at+2000).toUTCString()}}):Response.json({ok:true});}});
 assert.deepEqual(await s.get(gamma+'/markets'),{ok:true});assert.equal(calls,3);assert.deepEqual(waits,[1125,2000]);
 let count=0;const bounded=setup({fetcher:async()=>{count++;return new Response('',{status:429});}});await assert.rejects(()=>bounded.service.get(gamma+'/markets'));assert.equal(count,3);
 assert.equal(retryAfterMs('garbage',at),0);assert.equal(retryAfterMs('120',at),120000);
});
test('long Retry-After never retries early or bypasses origin cooldown with distinct queries/fresh',async()=>{
 let calls=0;const s=setup({fetcher:async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'120'}});}});
 await assert.rejects(()=>s.service.get(gamma+'/markets'));await assert.rejects(()=>s.service.get(gamma+'/markets',3000,true));await assert.rejects(()=>s.service.get(gamma+'/public-search?q=different'));assert.equal(calls,1);assert.equal(s.waits.length,0);
 s.time(120001);await assert.rejects(()=>s.service.get(gamma+'/markets'));assert.equal(calls,2);
});
test('retry consumes budget and origin gate prevents simultaneous retry stampedes',async()=>{
 let calls=0;const s=setup({budgets:{all:1,markets:1},fetcher:async()=>{calls++;return new Response('',{status:429});}});await assert.rejects(()=>s.service.get(gamma+'/markets'));assert.equal(calls,1);
 // Real asynchronous waits allow many unique queries to contend for a small shared budget.
 const callsAt:number[]=[];const paced=createPolymarketPublic({spacingMs:10,budgets:{all:3,markets:3},fetcher:async()=>{callsAt.push(Date.now());return Response.json({});}});
 const results=await Promise.allSettled(Array.from({length:12},(_,i)=>paced.get(gamma+'/markets/'+i)));assert.equal(callsAt.length,3);assert.equal(results.filter(x=>x.status==='rejected').length,9);assert(callsAt[2]-callsAt[0]>=15);
});
test('slot/inflight bounds and oversized response protection fail closed',async()=>{
 let release:any;const s=setup({maxPending:1,maxSlots:1,fetcher:()=>new Promise(r=>{release=r;})});const pending=s.service.get(gamma+'/markets/1');await assert.rejects(()=>s.service.get(gamma+'/markets/2'));release(Response.json({}));await pending;assert.equal(s.service.diagnostics().slots,1);await s.service.get(gamma+'/markets/1');
 const large=setup({fetcher:async()=>new Response('x'.repeat(6000001))});await assert.rejects(()=>large.service.get(gamma+'/markets'));
});
test('every REST consumer uses one server-owned gate and browser never needs public credentials',()=>{
 const data=readFileSync(new URL('../lib/polymarket-data.ts',import.meta.url),'utf8'),server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8'),history=readFileSync(new URL('../runtime/polymarket-history.mjs',import.meta.url),'utf8'),stream=readFileSync(new URL('../runtime/polymarket-stream.mjs',import.meta.url),'utf8');
 assert.match(data,/publicData:\{path,ttl,fresh\}/);assert.doesNotMatch(data,/fetch\(path/);assert.match(server,/polyPublic.get\(publicData.path/);assert.match(server,/fetchHistory:async tokenId=>\(await polyPublic.get/);assert.doesNotMatch(history,/fetch\(/);assert.match(stream,/new WebSocket\(url\)/);assert.doesNotMatch(stream,/api[_-]?key|authorization|secret/i);
});
