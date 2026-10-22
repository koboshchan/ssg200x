import test from 'node:test';
import assert from 'node:assert/strict';
import {OandaQuarantine,parseOandaPrice} from '../lib/oanda-stream';
const raw=(at:number)=>({type:'PRICE',instrument:'EUR_USD',time:new Date(at).toISOString(),tradeable:true,bids:[{price:'1',liquidity:1}],asks:[{price:'1.1',liquidity:1}]});
test('300ms waiting never publishes future and never rewrites clocks',()=>{const q=new OandaQuarantine();assert(q.offer(raw(100300),100000,5000,['EUR/USD']));for(const wall of [100000,100120,100180,100299]){assert.equal(parseOandaPrice(raw(100300),wall,5000+wall-100000),null);assert.deepEqual(q.release(wall,5000+wall-100000),[]);}const [t]=q.release(100300,5300);assert.deepEqual({at:t.at,received:t.received,mono:t.mono},{at:100300,received:100000,mono:5000});assert(t.at<=100300);});
test('backward monotonic and stale provider frames cannot escape holding area',()=>{const q=new OandaQuarantine();q.offer(raw(100300),100000,5000,['EUR/USD']);assert.deepEqual(q.release(100300,4999),[]);assert.equal(q.pending.size,0);q.offer(raw(100300),100000,5000,['EUR/USD']);assert.deepEqual(q.release(110301,5300),[]);assert.equal(q.pending.size,0);});
