import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {assertIsolatedQa} from "../runtime/isolated-qa.mjs";

test("QA startup requires exact marker/protection while absent marker preserves production",()=>{
 assert.doesNotThrow(()=>assertIsolatedQa({}));
 assert.doesNotThrow(()=>assertIsolatedQa({SSG_ISOLATED_QA:"1",QA_PROTECTED_COLLECTIONS:"candles"}));
 for(const marker of ["1","0","true",""," 1"]){
  for(const protection of [undefined,"","CANDLES","candles,rooms"," candles","rooms"]){
   assert.throws(()=>assertIsolatedQa({SSG_ISOLATED_QA:marker,QA_PROTECTED_COLLECTIONS:protection}),/Isolated QA requires/);
  }
 }
 for(const file of ["server.mjs","instrumentation.ts"]){
  const source=readFileSync(new URL("../"+file,import.meta.url),"utf8");
  const guard=source.indexOf("assertIsolatedQa();");
  assert.ok(guard>=0);
  for(const needle of ["setInterval(","new MongoClient(","startPriceWorker();","startTradingPerformanceWorker();","startPolymarketWorker();"]){
   const operation=source.indexOf(needle);
   if(operation>=0)assert.ok(guard<operation,file+" before "+needle);
  }
 }
});
test("invalid custom-server QA config exits before artifact/DB/worker initialization",()=>{
 const result=spawnSync(process.execPath,["server.mjs"],{
  cwd:new URL("..",import.meta.url),
  env:{...process.env,SSG_ISOLATED_QA:"1",QA_PROTECTED_COLLECTIONS:"",MONGODB_URI:"mongodb://127.0.0.1:1/"},
  encoding:"utf8",timeout:15000,
 });
 assert.equal(result.status,1);
 assert.match(result.stderr,/Isolated QA requires/);
 assert.doesNotMatch(result.stderr,/MongoServerSelectionError|ENOENT/);
});
test("instrumentation rejects invalid QA before importing workers",async()=>{
 const marker=process.env.SSG_ISOLATED_QA,protectedNames=process.env.QA_PROTECTED_COLLECTIONS;
 try{
  process.env.SSG_ISOLATED_QA="1";delete process.env.QA_PROTECTED_COLLECTIONS;
  const {register}=await import("../instrumentation");
  await assert.rejects(register(),/Isolated QA requires/);
 }finally{
  if(marker===undefined)delete process.env.SSG_ISOLATED_QA;else process.env.SSG_ISOLATED_QA=marker;
  if(protectedNames===undefined)delete process.env.QA_PROTECTED_COLLECTIONS;else process.env.QA_PROTECTED_COLLECTIONS=protectedNames;
 }
});

 test("isolated QA skips external price/prediction workers and durable prediction subscriptions",async()=>{
 const {readFile}=await import("node:fs/promises");
 const instrumentation=await readFile(new URL("../instrumentation.ts",import.meta.url),"utf8");
 const server=await readFile(new URL("../server.mjs",import.meta.url),"utf8");
 assert.match(instrumentation,/if\(process.env.SSG_ISOLATED_QA!=="1"\)\{[\s\S]*startPriceWorker[\s\S]*startPolymarketWorker\(\);\s*\}/);
 assert.match(server,/enabled:\(\)=>process.env.SSG_ISOLATED_QA!=="1"&&featureSettings.enabled\("polymarket"\)/);
 assert.match(server,/async function syncPolyPositions\(\)\{\s*if\(process.env.SSG_ISOLATED_QA==="1"\)return;/);
 assert.match(server,/External prediction feeds disabled in isolated QA/);
 });
