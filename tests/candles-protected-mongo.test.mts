// Run explicitly against an independently provisioned, never-restored EMPTY test DB.
// No skip mode and no dropDatabase/collection cleanup. Never reads existing candle data.
import test from "node:test";
import assert from "node:assert/strict";
import {MongoClient} from "mongodb";
import {execFileSync} from "node:child_process";

test("real Mongo protected candle and functional crypto publication leave candle namespace absent",async()=>{
 assert.equal(process.env.SSG_ISOLATED_QA,"1");
 assert.equal(process.env.QA_PROTECTED_COLLECTIONS,"candles");
 assert.equal(process.env.QA_EMPTY_CANDLE_DB_CONFIRM,"owned-empty-never-restored");
 assert.match(process.env.MONGODB_DB??"",/^ssg_qa_candle_guard_[a-zA-Z0-9_]+$/);
 assert.ok(process.env.MONGODB_URI,"independently provisioned Mongo required");
 const client=new MongoClient(process.env.MONGODB_URI);
 await client.connect();
 const database=client.db(process.env.MONGODB_DB);
 const metadata=async()=>{
  const collections=await database.listCollections({name:"candles"},{nameOnly:true}).toArray();
  let indexes:unknown[]=[];
  try{indexes=await database.collection("candles").listIndexes().toArray();}
  catch(error){assert.equal((error as {code?:number}).code,26,"only NamespaceNotFound allowed");}
  return {collections,indexes};
 };
 let closeDatabase:(()=>Promise<void>)|undefined;
 try{
  assert.deepEqual(await database.listCollections({},{nameOnly:true}).toArray(),[],"REFUSE any nonempty DB, never delete it");
  const before=await metadata();
  assert.deepEqual(before,{collections:[],indexes:[]});
  const candles=await import("../lib/candles");
  const dbModule=await import("../lib/db");closeDatabase=dbModule.closeDatabase;
  await candles.candleUpdate({BTC:{micro:100_000_000,at:Date.now()}});
  const session=client.startSession();
  try{await candles.candleUpdate({BTC:{micro:101_000_000,at:Date.now()}},session);}
  finally{await session.endSession();}
  await candles.candleUpdate({});
  assert.deepEqual(await metadata(),before);
  // Only this empty fixture DB may exercise a find on the absent candle namespace.
  assert.deepEqual(await candles.candleRead("BTC","1m",0,Date.now()),[]);
  assert.deepEqual(await metadata(),before);
  const {persistExchangeTicks}=await import("../lib/prices");
  const now=Date.now(),micro=123_000_000;
  await persistExchangeTicks([{symbol:"BTC",micro,at:now} as never]);
  const room=await dbModule.readRoom();
  assert.equal(room.quotes.BTC?.micro,micro,"real worker publication must still update quotes");
  assert.deepEqual(await metadata(),before);
  console.log(JSON.stringify({
   sha:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),
   database:process.env.MONGODB_DB,before,after:await metadata(),
   protectedUpdate:true,protectedSessionUpdate:true,protectedRead:true,
   functionalPersistExchangeTicksPublication:true,
  }));
 }finally{
  if(closeDatabase)await closeDatabase();
  await client.close();
 }
});
