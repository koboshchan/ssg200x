import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fork,execFile} from 'node:child_process';
import {db,closeDatabase} from '../../lib/db';
import {backfillStep,archivePlan,candleRead} from '../../lib/candles';
import {mutate} from '../../lib/store';
import {goLiveNow} from '../../lib/admin';
if(!process.env.MONGODB_DB?.startsWith('fakebucks_test_restart_'))throw Error('Isolated restart database required');
const fixture='tests/fixtures/backfill-restart-worker.ts';
function fresh(){return new Promise<any>((resolve,reject)=>execFile(process.execPath,['--import','tsx',fixture],{env:process.env},(e,out,err)=>e?reject(Error(err||String(e))):resolve(JSON.parse(out))));}
test('new processes skip completed downloads, recover a killed worker after lease expiry, and preserve go-live',async()=>{
 const d=await db();await d.dropDatabase();
 try{
  process.env.CANDLE_STORAGE_PATH='/no-such-restart-capacity-path';
  assert.equal((await backfillStep()).status,'blocked');delete process.env.CANDLE_STORAGE_PATH;
  const jobs=d.collection<any>('candle_backfill'),workers=d.collection<any>('workers');
  await jobs.updateMany({},{$set:{status:'done'}});
  const target=archivePlan().find(j=>j.symbol==='ETH')!;
  await jobs.updateOne({_id:target._id},{$set:{status:'pending'}});
  await mutate(r=>goLiveNow(r,{id:'restart-admin',name:'Restart admin',email:'restart@example.test',admin:true}));
  const queued=await jobs.countDocuments();
  const child=fork(fixture,[],{execArgv:['--import','tsx'],env:{...process.env,CRASH_AT_FETCH:'1'},stdio:['ignore','pipe','pipe','ipc']});
  try{
   await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker never reached download')),15000);child.once('message',()=>{clearTimeout(timer);resolve()});child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error('Worker exited before download'))});});
  }finally{const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await ended;}
  const abandoned=await jobs.findOne({_id:target._id});assert.equal(abandoned.attempts,1);assert.ok(abandoned.leaseUntil>Date.now());
  const beforeExpiry=await fresh();assert.deepEqual(beforeExpiry.urls,[]);assert.equal(beforeExpiry.maintenance.blocked,false);assert.equal(beforeExpiry.maintenance.background,true);
  // Advance persisted leases to the past rather than waiting five real minutes.
  await jobs.updateOne({_id:target._id},{$set:{leaseUntil:Date.now()-1}});
  await workers.updateOne({_id:'candle-backfill'},{$set:{nextAt:Date.now()-1}});
  const resumed=await fresh();assert.equal(resumed.result.status,'processed');assert.equal(resumed.result.job,target._id);assert.equal(resumed.urls.length,2);
  assert.equal(resumed.maintenance.background,true);assert.equal(resumed.maintenance.blocked,false);
  assert.equal((await jobs.findOne({_id:target._id})).attempts,2);
  assert.equal((await jobs.findOne({_id:target._id})).status,'done');
  const rows=await candleRead('ETH','1m',Date.parse(target.period+'-01'),Date.parse(target.period+'-28'));assert.equal(rows.length,1);
  const count=await d.collection('candles').countDocuments();
  await workers.updateOne({_id:'candle-backfill'},{$set:{nextAt:0}});
  const again=await fresh();assert.equal(again.result.status,'complete');assert.deepEqual(again.urls,[]);assert.equal(again.maintenance.background,true);assert.equal(again.maintenance.blocked,false);
  assert.equal(await d.collection('candles').countDocuments(),count);assert.equal(await jobs.countDocuments(),queued);
 }finally{delete process.env.CANDLE_STORAGE_PATH;await d.dropDatabase();await closeDatabase();}
});
