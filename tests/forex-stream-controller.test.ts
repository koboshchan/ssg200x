import test from 'node:test';
import assert from 'node:assert/strict';
import {OandaStream,type OandaOptions} from '../lib/oanda-stream';
import {ForexIsolation,forexStreamOptions} from '../lib/forex-isolation';
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
function setup(extra:Partial<OandaOptions>={}){
 let mono=0,pairs=['EUR/USD'],leader=true;
 const logs:Record<string,unknown>[]=[],requests:string[]=[],wires:ReadableStreamDefaultController<Uint8Array>[]=[];
 const stream=new OandaStream({symbols:()=>pairs,token:'private-token',account:'private-account',leader:()=>leader,now:()=>1700000000000+mono,mono:()=>mono,random:()=>0,log:e=>logs.push(e),publish:async()=>{},request:async url=>{requests.push(String(url));return new Response(new ReadableStream({start(c){wires.push(c);}}));},...extra});
 return {stream,logs,requests,wires,setMono:(v:number)=>{mono=v},setPairs:(v:string[])=>{pairs=v},setLeader:(v:boolean)=>{leader=v}};
}
test('five-second quiet debounce coalesces additions, ignores ordering and uses final desired pairs',async()=>{
 const x=setup();await x.stream.step();await flush();assert.equal(x.requests.length,1);
 x.setMono(100);x.setPairs(['EUR/USD','USD/JPY']);await x.stream.step();await flush();
 x.setMono(4000);x.setPairs(['GBP/USD','EUR/USD','USD/JPY']);await x.stream.step();await flush();
 x.setMono(8000);x.setPairs(['USD/JPY','EUR/USD','GBP/USD']);await x.stream.step();await flush();assert.equal(x.requests.length,1);
 x.setMono(8999);await x.stream.step();assert.equal(x.requests.length,1);
 x.setMono(9000);await x.stream.step();await flush();assert.equal(x.requests.length,2);
 assert.equal(new URL(x.requests[1]).searchParams.get('instruments'),'EUR_USD,GBP_USD,USD_JPY');
 assert.equal(x.logs.filter(e=>e.event==='failure').length,0);await x.stream.stop();
});
test('reconfigure awaits asynchronous reader cleanup, concurrent steps cannot overlap connection ownership',async()=>{
 const cleanup=deferred();let requests=0,active=0,max=0;
 const x=setup({debounceMs:0,minReconnectMs:0,request:async()=>{requests++;active++;max=Math.max(max,active);return new Response(new ReadableStream({cancel:async()=>{await cleanup.promise;active--;}}));}});
 await x.stream.step();await flush();x.setPairs(['GBP/USD']);await x.stream.step();await flush();
 await Promise.all(Array.from({length:10},()=>x.stream.step()));assert.equal(requests,1);assert.equal(active,1);
 cleanup.resolve();await flush();await Promise.all(Array.from({length:10},()=>x.stream.step()));await flush();
 assert.equal(requests,2);assert.equal(max,1);await x.stream.stop();assert.equal(active,0);
});
test('minimum reconnect interval survives deliberate reconfiguration without exponential failure penalty',async()=>{
 const x=setup({debounceMs:0,minReconnectMs:1000});await x.stream.step();await flush();x.setMono(100);x.setPairs(['GBP/USD']);await x.stream.step();await flush();
 x.setMono(999);await x.stream.step();assert.equal(x.requests.length,1);x.setMono(1000);await x.stream.step();await flush();assert.equal(x.requests.length,2);
 assert.equal((x.stream as any).failures,0);await x.stream.stop();
});
test('HTTP rejection records status only, uses jittered backoff on monotonic clock, sanitizes provider body',async()=>{
 let calls=0;const x=setup({random:()=>.5,request:async()=>{calls++;return new Response('private-token private-account secret body',{status:429});}});
 await x.stream.step();await flush();assert.equal(calls,1);
 const failure=x.logs.find(e=>e.event==='failure');assert.equal(failure?.reason,'http');assert.equal(failure?.status,429);
 x.setMono(1124);await x.stream.step();assert.equal(calls,1);x.setMono(1125);await x.stream.step();await flush();assert.equal(calls,2);
 const serialized=JSON.stringify(x.logs);for(const needle of ['private-token','private-account','secret body','https:'])assert(!serialized.includes(needle));await x.stream.stop();
});
test('transport errors and EOF have distinct sanitized lifecycle events and generation correlation',async()=>{
 const transport=setup({request:async()=>{throw new TypeError('private-token https://secret-account',{cause:Error('private-account')});}});
 await transport.stream.step();await flush();const failure=transport.logs.find(e=>e.event==='failure');assert.equal(failure?.reason,'transport');assert.equal(failure?.kind,'TypeError');assert(!JSON.stringify(transport.logs).includes('private-'));
 const eof=setup();await eof.stream.step();await flush();eof.wires[0].close();await flush();assert(eof.logs.some(e=>e.event==='eof'));assert(!eof.logs.some(e=>e.event==='failure'));
 const generation=eof.logs.find(e=>e.event==='connect')!.generation;assert.equal(eof.logs.find(e=>e.event==='cleanup')?.generation,generation);
 await transport.stream.stop();await eof.stream.stop();
});
test('stop before connecting publication completes never issues a late authenticated request',async()=>{
 const publish=deferred();let calls=0;const x=setup({publish:async(_t,state)=>{if(state==='connecting')await publish.promise;},request:async()=>{calls++;return new Response('');}});
 await x.stream.step();const stopped=x.stream.stop();publish.resolve();await stopped;await x.stream.step();assert.equal(calls,0);
 assert(!x.logs.some(e=>e.event==='failure'));assert(x.logs.some(e=>e.event==='cleanup'&&e.reason==='stopped'));
});
test('symbol removal and lease loss immediately fence cached prices, old buffered generation cannot reappear',async()=>{
 const x=setup();await x.stream.step();await flush();
 const raw={type:'PRICE',instrument:'EUR_USD',time:new Date(1700000000000).toISOString(),tradeable:true,bids:[{price:'1.1',liquidity:1}],asks:[{price:'1.1',liquidity:1}]};
 x.wires[0].enqueue(new TextEncoder().encode(JSON.stringify(raw)+'\n'));await flush();assert.equal(x.stream.fresh().length,1);
 x.setPairs([]);assert.equal(x.stream.fresh().length,0);await x.stream.step();await flush();x.setMono(10000);await x.stream.step();assert.equal(x.requests.length,1);
 x.setPairs(['EUR/USD']);await x.stream.step();await flush();x.setMono(15000);await x.stream.step();await flush();assert.equal(x.requests.length,2);
 x.setLeader(false);await x.stream.step();await flush();assert.equal(x.stream.fresh().length,0);assert(x.logs.some(e=>e.event==='cleanup'&&e.reason==='lease_lost'));await x.stream.stop();
});
test('publication error is not misreported as EOF or transport and includes no error text',async()=>{
 const x=setup({publish:async(_t,state)=>{if(state==='connecting')throw Error('private-token publication details');}});await x.stream.step();await flush();
 assert.equal(x.requests.length,0);assert.equal(x.logs.find(e=>e.event==='failure')?.reason,'publication');assert(!JSON.stringify(x.logs).includes('private-token'));await x.stream.stop();
});
test('isolation stop waits for reader cleanup before releasing lease; queued restart follows release',async()=>{
 const cleanup=deferred();const events:string[]=[];let revokes=0;
 const x=new ForexIsolation({options:()=>forexStreamOptions({FX_STREAM_ENABLED:'true',FX_STREAM_ENV:'test'}),now:()=>0,claim:async()=>{events.push('claim');return true},release:async()=>{events.push('release')},step:async()=>{events.push('step')},revoke:()=>{revokes++;return cleanup.promise}});
 await x.step();const stopped=x.stop();const restarted=x.step();await flush();assert.equal(x.leader(),false);assert.deepEqual(events,['claim','step']);
 cleanup.resolve();await stopped;await restarted;assert.deepEqual(events,['claim','step','release','claim','step']);assert.equal(revokes,1);
});
test('stop during pending lease claim cannot resurrect old stream; later step can claim again',async()=>{
 const claim=deferred();let steps=0,releases=0;
 const x=new ForexIsolation({options:()=>forexStreamOptions({FX_STREAM_ENABLED:'true',FX_STREAM_ENV:'test'}),now:()=>0,claim:async()=>{await claim.promise;return true},release:async()=>{releases++},step:async()=>{steps++},revoke:async()=>{}});
 const pending=x.step();await flush();const stopped=x.stop();claim.resolve();await pending;await stopped;assert.equal(steps,0);assert.equal(releases,1);assert.equal(x.leader(),false);await x.step();assert.equal(steps,1);
});
test('new desired symbol list discards old failure backoff without defeating quiet debounce',async()=>{
 let calls=0;const x=setup({request:async()=>{calls++;return new Response('',{status:503});}});
 for(let attempt=0;attempt<5;attempt++){await x.stream.step();await flush();x.setMono((attempt+1)*10000);}
 assert.equal(calls,5);x.setPairs(['GBP/USD']);await x.stream.step();await flush();assert.equal((x.stream as any).failures,0);
 x.setMono(54999);await x.stream.step();assert.equal(calls,5);x.setMono(55000);await x.stream.step();await flush();assert.equal(calls,6);await x.stream.stop();
});
test('sustained reconnect backoff retains bounded jitter instead of clamping every delay to the same cap',async()=>{
 const x=setup({random:()=>.5});(x.stream as any).failures=100;assert.equal((x.stream as any).retryDelay(),27000);await x.stream.stop();
});
test('a response arriving after revoke is canceled before reader adoption and before restart',async()=>{
 let deliver!:(response:Response)=>void,canceled=0;
 const x=setup({request:async()=>new Promise<Response>(resolve=>{deliver=resolve})});await x.stream.step();await flush();
 const stopped=x.stream.stop();deliver(new Response(new ReadableStream({cancel(){canceled++;}})));await stopped;assert.equal(canceled,1);assert(!x.logs.some(e=>e.event==='failure'));
});
test('transport cause exposes only known network codes, never arbitrary cause text or code',async()=>{
 const x=setup({request:async()=>{throw new TypeError('private-token',{cause:{code:'ECONNRESET',message:'private-account'}});}});await x.stream.step();await flush();assert.equal(x.logs.find(e=>e.event==='failure')?.code,'ECONNRESET');assert(!JSON.stringify(x.logs).includes('private-'));await x.stream.stop();
 const y=setup({request:async()=>{throw new TypeError('private-token',{cause:{code:'private-token'}});}});await y.stream.step();await flush();assert.equal(y.logs.find(e=>e.event==='failure')?.code,undefined);await y.stream.stop();
});
for(const phase of ['claim','connecting','reader'] as const)test(`feature disable during ${phase} fences queued and in-flight work until explicit re-enable`,async()=>{
 let enabled=true,requests=0,claims=0,releases=0,aborts=0,cancels=0;const delayed=deferred();
 const stream:OandaStream=new OandaStream({symbols:()=>['EUR/USD'],token:'t',account:'a',leader:()=>enabled&&isolation.leader(),now:()=>0,mono:()=>0,minReconnectMs:0,log:()=>{},publish:async(_t,state)=>{if(phase==='connecting'&&state==='connecting')await delayed.promise},request:async(_url,init)=>{requests++;init?.signal?.addEventListener('abort',()=>{aborts++},{once:true});return new Response(new ReadableStream({cancel(){cancels++}}));}});
 const isolation:ForexIsolation=new ForexIsolation({options:()=>({...forexStreamOptions({FX_STREAM_ENABLED:'true',FX_STREAM_ENV:'test'}),enabled}),now:()=>0,claim:async()=>{claims++;if(phase==='claim')await delayed.promise;return true},release:async()=>{releases++},step:()=>stream.step(),revoke:()=>stream.revoke()});
 const running=isolation.step();await flush();const queued=isolation.step();enabled=false;const stopped=isolation.stop();assert.equal(isolation.leader(),false);delayed.resolve();await Promise.all([running,queued,stopped]);await flush();
 assert.equal(requests,phase==='reader'?1:0);assert.equal(releases,1);assert.equal(stream.fresh().length,0);const before=claims;await isolation.step();await flush();assert.equal(claims,before);assert.equal(requests,phase==='reader'?1:0);
 if(phase==='reader'){assert.equal(aborts,1);assert.equal(cancels,1);}
 enabled=true;await isolation.step();await flush();assert.equal(requests,phase==='reader'?2:1);enabled=false;await isolation.stop();await stream.stop();
});
