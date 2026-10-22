import test from 'node:test';import assert from 'node:assert/strict';
import {forexStreamOptions,ForexIsolation} from '../lib/forex-isolation';
import {OandaStream} from '../lib/oanda-stream';
test('explicit enable and namespace required regardless of production mode or secrets',()=>{
 for(const enabled of [undefined,'','false','1','yes'])assert.equal(forexStreamOptions({NODE_ENV:'production',OANDA_API_TOKEN:'t',OANDA_ACCOUNT_ID:'a',FX_STREAM_ENABLED:enabled,FX_STREAM_ENV:'prod'}).enabled,false);
 for(const env of ['', '../prod','prod:dev','a'.repeat(65)])assert.equal(forexStreamOptions({FX_STREAM_ENABLED:'true',FX_STREAM_ENV:env}).enabled,false);
 assert.equal(forexStreamOptions({FX_STREAM_ENABLED:' true ',FX_STREAM_ENV:'prod'}).enabled,true);
 assert.notEqual(forexStreamOptions({FX_STREAM_ENV:'prod'}).leaseId,forexStreamOptions({FX_STREAM_ENV:'dev'}).leaseId);
});
test('disabled no lease/no outbound; enabled single lease; disable aborts and clears held release timer',async()=>{
 let enabled=false,now=1000,claims=0,releases=0,requests=0,aborts=0;let controller:any;
 const options=()=>forexStreamOptions({FX_STREAM_ENABLED:String(enabled),FX_STREAM_ENV:'dev'});
 const stream:OandaStream=new OandaStream({symbols:()=>['EUR/USD'],token:'t',account:'a',leader:():boolean=>isolation.leader(),now:()=>now,mono:()=>now,publish:async()=>{},request:async(_u,i)=>{requests++;return new Response(new ReadableStream({start(c){controller=c;i?.signal?.addEventListener('abort',()=>{aborts++;c.close()},{once:true})}}))}});
 const isolation:ForexIsolation=new ForexIsolation({options,now:()=>now,claim:async id=>{assert.equal(id,'oanda-feed:dev');claims++;return true},release:async id=>{assert.equal(id,'oanda-feed:dev');releases++},step:():Promise<void>=>stream.step(),revoke:()=>stream.revoke()});
 await isolation.step();assert.equal(claims,0);assert.equal(requests,0);
 enabled=true;await isolation.step();await new Promise(r=>setImmediate(r));await isolation.step();assert.equal(claims,1);assert.equal(requests,1);
 controller.enqueue(new TextEncoder().encode(JSON.stringify({type:'PRICE',instrument:'EUR_USD',time:new Date(now+100).toISOString(),tradeable:true,bids:[{price:'1',liquidity:1}],asks:[{price:'1.1',liquidity:1}]})+'\n'));
 await new Promise(r=>setImmediate(r));assert((stream as any).quarantine.pending.size>0);
 enabled=false;await isolation.step();await new Promise(r=>setImmediate(r));assert.equal(aborts,1);assert.equal(stream.ticks.size,0);assert.equal((stream as any).quarantine.pending.size,0);assert.equal((stream as any).releaseTimer,undefined);assert.equal(releases,1);assert.equal(isolation.leader(),false);await isolation.step();assert.equal(claims,1);
});
test('lease loss and namespace changes release only previous scope; no stream before acknowledged claim',async()=>{
 let env='dev',allow=true,steps=0;const released:string[]=[];let now=0;
 const x=new ForexIsolation({options:()=>forexStreamOptions({FX_STREAM_ENABLED:'true',FX_STREAM_ENV:env}),now:()=>now,claim:async()=>allow,release:async id=>{released.push(id)},step:async()=>{steps++},revoke:()=>{}});
 await x.step();assert.equal(steps,1);env='qa';await x.step();assert.deepEqual(released,['oanda-feed:dev']);assert.equal(steps,2);allow=false;now=12000;await x.step();assert.equal(x.leader(),false);assert.deepEqual(released,['oanda-feed:dev','oanda-feed:qa']);assert.equal(steps,2);
});
