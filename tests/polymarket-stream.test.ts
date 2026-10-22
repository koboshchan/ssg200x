import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error runtime module is exercised directly under Node
import {createPolymarketStream,attachPolymarketPresence} from '../runtime/polymarket-stream.mjs';
class Wire extends EventTarget{
 readyState=0;frames:string[]=[];
 send(s:string){this.frames.push(s);}
 close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
 open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
 message(x:unknown){this.dispatchEvent(new MessageEvent('message',{data:typeof x==='string'?x:JSON.stringify(x)}));}
}
function setup(){let at=100000;const wires:Wire[]=[];const changes:string[]=[];const stream=createPolymarketStream({now:()=>at,connect:()=>{const w=new Wire();wires.push(w);return w;},onChange:(id:string)=>changes.push(id)});return{stream,wires,changes,time:(n:number)=>{at+=n;stream.sweep();},now:()=>at};}
const snapshot=(token='11')=>({event_type:'book',asset_id:token,market:'cond',timestamp:'1000',bids:[{price:'.4',size:'100'}],asks:[{price:'.6',size:'100'}]});
test('grid with zero demand opens nothing; duplicate viewer refs share one connection and token subscriptions',()=>{
 const {stream,wires}=setup();stream.sweep();assert.equal(wires.length,0);
 stream.setViewer('a','1',['11','12']);stream.setViewer('b','1',['11','12']);stream.setViewer('a','1',['11','12']);assert.equal(wires.length,1);
 wires[0].open();assert.equal(wires[0].frames.length,1);assert.deepEqual(JSON.parse(wires[0].frames[0]).assets_ids,['11','12']);assert.equal(stream.diagnostics().markets[0].viewers,2);stream.stop();
});
test('leave/switch/disconnect refcounts, grace cancellation and zero-demand teardown',()=>{
 const {stream,wires,time}=setup();stream.setViewer('a','1',['11','12']);stream.setViewer('b','1',['11','12']);wires[0].open();
 stream.setViewer('a','2',['21','22']);assert.equal(stream.diagnostics().markets.find((m:any)=>m.id==='1').viewers,1);
 stream.setViewer('b',null);time(4000);assert(stream.diagnostics().subscribed.includes('11'));
 stream.setViewer('c','1',['11','12']);time(2000);assert(stream.diagnostics().subscribed.includes('11'));
 stream.setViewer('c',null);time(5001);assert(!stream.diagnostics().subscribed.includes('11'));
 assert(wires[0].frames.some(s=>s.includes('unsubscribe')));stream.setViewer('a',null);time(5001);assert.equal(stream.diagnostics().connections,0);stream.stop();
});
test('durable positions restore/pin demand without viewers, last sell or settlement releases after grace',()=>{
 const {stream,wires,time}=setup();stream.syncPositions([{marketId:'1',tokenId:'11',shareMicros:5},{marketId:'1',tokenId:'11',shareMicros:6}]);wires[0].open();
 stream.setViewer('a','1',['11','12']);stream.setViewer('a',null);time(7000);assert.equal(stream.diagnostics().connections,1);assert.equal(stream.diagnostics().markets[0].positions,1);
 stream.syncPositions([]);time(5001);assert.equal(stream.diagnostics().connections,0);stream.stop();
});
test('stream snapshot only, depth deltas and canonical price keys, fresh price gating and healthy reconnect resubscription',()=>{
 const {stream,wires,time}=setup();stream.setViewer('a','1',['11','12']);wires[0].open();assert.equal(stream.read('11'),null);
 wires[0].message(snapshot());const b=stream.read('11');assert.equal(b.source,'stream');assert.equal(b.timestamp,100000);assert.equal(b.sourceAt,1000);
 wires[0].message({event_type:'price_change',market:'cond',price_changes:[{asset_id:'11',side:'BUY',price:'0.4',size:'50'}],timestamp:'100001'});
 assert.deepEqual(stream.read('11').bids,[{price:'0.4',size:'50'}]);
 time(10001);assert.equal(stream.read('11'),null);assert(wires[0].frames.includes('PING'));wires[0].message('PONG');assert.equal(stream.read('11'),null,'heartbeat is not a price');
 wires[0].message(snapshot());assert(stream.read('11'));wires[0].close();assert.equal(stream.read('11'),null);time(501);assert.equal(wires.length,2);wires[1].open();assert.deepEqual(JSON.parse(wires[1].frames[0]).assets_ids,['11','12']);assert.equal(stream.read('11'),null,'reconnect needs fresh snapshot');wires[1].message(snapshot());assert(stream.read('11'));stream.stop();
});
test('heartbeat timeout kills stale connection, wrong market and unsolicited tokens cannot enter cache',()=>{
 const {stream,wires,time}=setup();stream.setViewer('a','1',['11','12']);wires[0].open();wires[0].message(snapshot('99'));assert.equal(stream.read('99'),null);
 wires[0].message(snapshot());wires[0].message({event_type:'price_change',market:'other',price_changes:[{asset_id:'11',side:'BUY',price:'.9',size:'99'}]});assert.equal(stream.read('11').bids[0].price,'.4');time(25001);assert.equal(stream.diagnostics().connected,false);assert.equal(stream.read('11'),null);stream.stop();
});
class Socket{
 id='s';connected=true;data={marketRoute:'/polymarket',expires:999999};handlers=new Map<string,Function>();on(name:string,f:Function){this.handlers.set(name,f);}async call(name:string,p:any){let answer:any;await this.handlers.get(name)?.(p,(a:any)=>{answer=a;});return answer;}
}
test('presence validates route/id/session, bounds rate, handles pending leave and disconnect',async()=>{
 const {stream}=setup(),s=new Socket();let checks=0;let release:Function=()=>{};
 let resolveMarket=async()=>({tokens:['11','12']});
 attachPolymarketPresence(s,{stream,resolveMarket:(id:string)=>resolveMarket(),checkSession:async()=>{checks++;},now:()=>100000});
 assert.equal((await s.call('polymarket:watch','bad')).ok,false);assert.equal(checks,0);
 s.data.marketRoute='/poker';assert.equal((await s.call('polymarket:watch','1')).ok,false);s.data.marketRoute='/polymarket';
 assert.equal((await s.call('polymarket:watch','1')).ok,true);assert.equal(stream.diagnostics().markets[0].viewers,1);
 for(let i=0;i<22;i++)await s.call('polymarket:watch','1');assert.equal((await s.call('polymarket:watch','1')).ok,false);
 await s.call('polymarket:watch',null);assert.equal(stream.diagnostics().markets[0].viewers,0);
 const s2=new Socket();s2.id='s2';resolveMarket=()=>new Promise(r=>{release=r;});attachPolymarketPresence(s2,{stream,resolveMarket:()=>resolveMarket(),checkSession:async()=>{},now:()=>100000});
 const pending=s2.call('polymarket:watch','1');await Promise.resolve();await s2.call('polymarket:watch',null);release({tokens:['11','12']});await pending;assert.equal(stream.diagnostics().markets[0].viewers,0);
 s.handlers.get('disconnect')?.();stream.stop();
});

test('pending presence cannot acquire demand after revoked session or route change',async()=>{
 const {stream}=setup(),s=new Socket();s.data.expires=999;
 attachPolymarketPresence(s,{stream,resolveMarket:async()=>({tokens:['11','12']}),checkSession:async()=>{},now:()=>100000});
 assert.equal((await s.call('polymarket:watch','1')).ok,false);assert.equal(stream.diagnostics().markets.length,0);
 s.data.expires=999999;s.data.marketRoute='/polymarket';let release:Function=()=>{};
 const s2=new Socket();attachPolymarketPresence(s2,{stream,resolveMarket:()=>new Promise(r=>{release=r;}),checkSession:async()=>{},now:()=>100000});
 const pending=s2.call('polymarket:watch','1');await Promise.resolve();s2.data.marketRoute='/markets';await s2.call('tab:report',{route:'/markets'});release({tokens:['11','12']});await pending;
 assert.equal(stream.diagnostics().markets.length,0);stream.stop();
});

test('connection handshake timeout retries without opening parallel upstream connections',()=>{
 const {stream,wires,time}=setup();stream.setViewer('a','1',['11','12']);time(10001);assert.equal(stream.diagnostics().connections,0);time(501);assert.equal(wires.length,2);wires[0].open();assert.equal(wires[0].frames.length,0);wires[1].open();assert.equal(stream.diagnostics().connections,1);stream.stop();
});

test('malformed replacement snapshot invalidates last executable book',()=>{
 const {stream,wires}=setup();stream.setViewer('a','1',['11','12']);wires[0].open();wires[0].message(snapshot());assert(stream.read('11'));wires[0].message({...snapshot(),asks:[{price:'bad',size:'1'}]});assert.equal(stream.read('11'),null);stream.stop();
});
