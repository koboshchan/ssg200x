import test from 'node:test';
import assert from 'node:assert/strict';
import {OandaStream} from '../lib/oanda-stream';
for(const cancel of ['disconnect','generation','configuration','lease'] as const)test(`stream holding cancelled on ${cancel}`,async()=>{
 let wall=100000,mono=5000,leader=true,pairs=['EUR/USD'];let wire!:ReadableStreamDefaultController<Uint8Array>;const published:any[]=[];
 const stream=new OandaStream({symbols:()=>pairs,token:'test',account:'test',leader:()=>leader,now:()=>wall,mono:()=>mono,request:(async()=>new Response(new ReadableStream({start(c){wire=c;}}))) as typeof fetch,publish:async(t)=>{published.push(...t);}});
 await stream.step();await new Promise<void>(r=>setImmediate(r));
 wire.enqueue(new TextEncoder().encode(JSON.stringify({type:'PRICE',instrument:'EUR_USD',time:new Date(100300).toISOString(),tradeable:true,bids:[{price:'1',liquidity:1}],asks:[{price:'1.1',liquidity:1}]})+'\n'));
 await new Promise<void>(r=>setImmediate(r));
 assert.equal((stream as any).quarantine.pending.size,1);assert.equal(published.length,0);
 if(cancel==='disconnect'){wire.close();await new Promise<void>(r=>setImmediate(r));}
 if(cancel==='generation')stream.revoke();
 if(cancel==='configuration'){pairs=['USD/JPY'];await stream.step();}
 if(cancel==='lease'){leader=false;await stream.step();}
 assert.equal((stream as any).quarantine.pending.size,0);wall=100400;mono=5400;assert.equal(published.length,0);stream.stop();
});
