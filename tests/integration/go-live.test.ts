import {test,after,before} from "node:test";
import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {db,closeDatabase,readRoom} from "../../lib/db";
import {mutate} from "../../lib/store";
import {goLiveNow} from "../../lib/admin";
import {siteMaintenance} from "../../lib/site-maintenance";
import {backfillStep} from "../../lib/candles";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw Error("Requires isolated test DB");
process.env.MONGODB_DB+="_go_live";
before(async()=>{await(await db()).dropDatabase();});
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
test("go-live commits a durable audited override, survives a new process and leaves worker enabled",async()=>{
 const database=await db(),admin={id:"host",name:"Host",email:"host@example.test",admin:true};
 await mutate(r=>{r.siteMaintenance=true;});
 assert.equal((await siteMaintenance(false)).blocked,true);
 const job={_id:"BTC:monthly:2026-09",status:"pending",attempts:0};
 await database.collection<{_id:string;status:string;attempts:number}>("candle_backfill").insertOne(job);
 await assert.rejects(mutate(r=>goLiveNow(r,{...admin,admin:false})),/Administrator/);
 await mutate(r=>goLiveNow(r,admin));
 const open=await siteMaintenance(false);
 assert.equal(open.active,false);assert.equal(open.blocked,false);assert.equal(open.backfill,true);assert.equal(open.background,true);
 assert.deepEqual(await database.collection("candle_backfill").findOne({}),job);
 assert.equal((await readRoom()).backfillInBackground,true);
 assert.equal(await database.collection("audit").countDocuments({what:"backfill-go-live"}),1);
 // A genuinely new process has no in-memory maintenance/cache state.
 const child=await new Promise<string>((resolve,reject)=>execFile(process.execPath,["--import","tsx","-e",'const {siteMaintenance}=require("./lib/site-maintenance");const {closeDatabase}=require("./lib/db");siteMaintenance(false).then(s=>{console.log(JSON.stringify(s));return closeDatabase()}).catch(()=>process.exit(1))'],{env:process.env},(e,out)=>e?reject(e):resolve(out)));
 const afterRestart=JSON.parse(child);assert.equal(afterRestart.blocked,false);assert.equal(afterRestart.backfill,true);assert.equal(afterRestart.background,true);
 await mutate(r=>goLiveNow(r,admin));
 assert.equal(await database.collection("audit").countDocuments({what:"backfill-go-live"}),1);
 // The choice is not an override of future deliberate manual maintenance.
 await mutate(r=>{r.siteMaintenance=true;});
 assert.equal((await siteMaintenance(false)).blocked,true);
 await mutate(r=>goLiveNow(r,admin));
 assert.equal((await siteMaintenance(false)).blocked,false);
 assert.equal(await database.collection("audit").countDocuments({what:"backfill-go-live"}),2);
 // Exercise the actual worker: capacity blocked still seeds jobs, rather than idle/disabled.
 const oldPath=process.env.CANDLE_STORAGE_PATH;process.env.CANDLE_STORAGE_PATH="/no-such-go-live-test-path";
 try{assert.equal((await backfillStep()).status,"blocked");}finally{if(oldPath===undefined)delete process.env.CANDLE_STORAGE_PATH;else process.env.CANDLE_STORAGE_PATH=oldPath;}
 assert.ok(await database.collection("candle_backfill").countDocuments()>1);
});
test("Mongo chart snapshots show sparse arrivals and live candles while history is unfinished",async()=>{
 const {chartSnapshotCache,chartSelection}=await import("../../lib/chart-snapshot");
 const {candleRead,candleUpdate}=await import("../../lib/candles");
 let now=Date.now();const width=60000,to=Math.floor(now/width)*width;
 const snapshot=chartSnapshotCache(candleRead,()=>now),selection=chartSelection("ETH","1m")!;
 assert.deepEqual(await snapshot(selection),[]);
 await candleUpdate({ETH:{micro:100_000_000,at:to}});
 now+=2001;
 const live=await snapshot(selection);assert.equal(live.length,1);assert.equal(live[0].close,100);
 await candleUpdate({ETH:{micro:90_000_000,at:to-180000}});
 now+=2001;
 const filled=await snapshot(selection);
 assert.deepEqual(filled.map(c=>c.time),[to-180000,to]);
 assert.equal(filled.at(-1)!.close,100);
 assert.equal((await siteMaintenance(false)).blocked,false);
});
