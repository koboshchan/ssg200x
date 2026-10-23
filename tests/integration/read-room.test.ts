import {test,after,mock} from "node:test";
import assert from "node:assert/strict";
import {Collection} from "mongodb";
import {db,rooms,readRoom,closeDatabase} from "../../lib/db";
import {freshRoom,register,assertRoom} from "../../lib/poker";
import {mutate} from "../../lib/store";
import {applyMarketTick} from "../../lib/market-tick";
import {openPosition,spot} from "../../lib/finance";
import {miniAction} from "../../lib/minigames";
import {randomUUID} from "node:crypto";
import {freshPokerTable} from "../../lib/poker-tables";
import {marketSymbols} from "../../lib/symbol-registry";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_")||!/^mongodb:\/\/(localhost|127\.0\.0\.1):\d+\//.test(process.env.MONGODB_URI??""))throw Error("Requires isolated localhost test database");
process.env.MONGODB_DB+="_read_room";
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
async function withoutWrites<T>(fn:()=>Promise<T>){
 // Spy on the actual driver, not a fake DB. Tests run in their own process.
 const spy=mock.method(Collection.prototype,"updateOne");
 try{const result=await fn();assert.equal(spy.mock.callCount(),0,"current room reads must not issue updates");return result;}
 finally{spy.mock.restore();}
}
test("concurrent cold-start reads seed one room; subsequent snapshots issue no updates",async()=>{
 const c=await rooms();await c.deleteMany({});
 const seeded=await Promise.all(Array.from({length:12},()=>readRoom()));
 assert.equal(await c.countDocuments({}),1);
 for(const r of seeded){assert.equal(r.version,0);assert.equal(r.seats.length,12);assert.ok(r.marketSymbols);}
 const snapshots=await withoutWrites(()=>Promise.all(Array.from({length:20},()=>readRoom())));
 for(const r of snapshots)assert.deepEqual(r,seeded[0]);
 await closeDatabase();
 await withoutWrites(async()=>assert.deepEqual(await readRoom(),seeded[0]));
});
test("fresh snapshots observe changes and repair deletion without any initialization cache",async()=>{
 const c=await rooms(),before=await readRoom();
 await c.updateOne({_id:"main"},{$set:{house:123},$inc:{version:1}});
 await withoutWrites(async()=>{const next=await readRoom();assert.equal(next.house,123);assert.equal(next.version,before.version+1);});
 await c.deleteOne({_id:"main"});
 const restored=await readRoom();assert.equal(restored.version,0);assert.equal(restored.house??0,0);
 assert.ok(restored.marketSymbols);assert.equal(restored.seats.length,12);
});
test("mixed legacy seat sizes still expand once and fence stale CAS, then become read-only",async()=>{
 const c=await rooms(),r=freshRoom();
 r.marketSymbols=marketSymbols();r.version=40;r.seats=r.seats.slice(0,6);
 r.pokerTables={"02":freshPokerTable(),"03":freshPokerTable()};
 r.pokerTables["02"]!.seats=r.pokerTables["02"]!.seats.slice(0,8);
 await c.replaceOne({_id:"main"},r);const before=(await c.findOne({_id:"main"}))!;
 const snapshots=await Promise.all(Array.from({length:12},()=>readRoom()));
 for(const actual of snapshots){
  assert.equal(actual.version,42);assert.equal(actual.seats.length,12);
  assert.equal(actual.pokerTables!["02"]!.seats.length,12);
  assert.deepEqual(actual.pokerTables!["03"],before.pokerTables!["03"]);
  assert.deepEqual(actual.seats.slice(0,6),before.seats);
  assert.deepEqual(actual.pokerTables!["02"]!.seats.slice(0,8),before.pokerTables!["02"]!.seats);
 }
 assert.equal((await c.replaceOne({_id:"main",version:40},before)).matchedCount,0);
 await withoutWrites(async()=>assert.deepEqual(await readRoom(),snapshots[0]));
});
test("missing symbol registry still initializes once without overwriting administrator edits",async()=>{
 const c=await rooms();await c.updateOne({_id:"main"},{$unset:{marketSymbols:""}});
 const before=await c.findOne({_id:"main"});
 const snapshots=await Promise.all(Array.from({length:8},()=>readRoom()));
 for(const r of snapshots){assert.ok(r.marketSymbols);assert.equal(r.version,before!.version+1);}
 const registry={...marketSymbols(),crypto:["BTC"]};
 await c.updateOne({_id:"main"},{$set:{marketSymbols:registry},$inc:{version:1}});
 await withoutWrites(async()=>assert.deepEqual((await readRoom()).marketSymbols,registry));
});

test("read-only snapshots preserve atomic marks/liquidations and exactly-once settlement under CAS races",async()=>{
 const c=await rooms();await c.deleteMany({});
 const who={id:"read-room-finance",name:"Finance",email:"qa@invalid",admin:true},at=Date.now(),generation="read-room-fixture";
 await mutate(r=>{
  register(r,who);
  r.cryptoStatus={connected:true,heartbeatSubscribed:true,generation,lastMessage:at,leaseUntil:at+10000};
  applyMarketTick(r,{BTC:{micro:100_000_000_000,at,cryptoGeneration:generation}},at);
  openPosition(r,who,"BTC","long",1000,200,"read-room-position",at);
 });
 const before=await readRoom(),collateral=before.members[0].positions![0].collateral??1000,quote={BTC:{micro:99_500_000_000,at:at+1,cryptoGeneration:generation}};
 const [outcomes,snapshots]=await Promise.all([
  Promise.all(Array.from({length:6},()=>mutate(r=>applyMarketTick(r,quote,at+1)))),
  Promise.all(Array.from({length:20},()=>readRoom()))
 ]);
 for(const snapshot of snapshots){
  const settled=snapshot.quotes!.BTC!.micro===quote.BTC.micro;
  assert.equal(snapshot.members[0].positions!.length,settled?0:1);
  assert.equal(snapshot.members[0].closedPositions?.length??0,settled?1:0);
  assert.equal(snapshot.house,before.house!+(settled?collateral:0));assertRoom(snapshot);
 }
 for(const {room} of outcomes){
  assert.equal(room.quotes!.BTC!.micro,quote.BTC.micro);
  assert.equal(room.members[0].positions!.length,0);
  assert.equal(room.members[0].closedPositions!.length,1);
  assert.equal(room.members[0].closedPositions![0].reason,"Liq");
  assert.equal(room.members[0].wallet,99000);
  assert.equal(room.house,(before.house??0)+collateral);assertRoom(room);
 }
 await withoutWrites(async()=>{const saved=await readRoom();assert.equal(saved.members[0].closedPositions!.length,1);assert.equal(saved.house,(before.house??0)+collateral);assert.equal(saved.version,before.version+6);});
});

test("partially legacy documents inspect every existing table independently",async()=>{
 const c=await rooms();
 for(const id of ["02","03"] as const)for(const size of [6,8]){
  const r=freshRoom();r.marketSymbols=marketSymbols();r.version=10;
  r.pokerTables={[id]:freshPokerTable()};r.pokerTables[id]!.seats=r.pokerTables[id]!.seats.slice(0,size);
  await c.replaceOne({_id:"main"},r);
  const snapshots=await Promise.all(Array.from({length:8},()=>readRoom()));
  for(const actual of snapshots){assert.equal(actual.version,11);assert.equal(actual.pokerTables![id]!.seats.length,12);assert.equal(Object.keys(actual.pokerTables!).length,1);}
  await withoutWrites(()=>readRoom());
 }
 // Absent secondary tables are lazy defaults, not migrations. Preserve them.
 const r=freshRoom();r.marketSymbols=marketSymbols();await c.replaceOne({_id:"main"},r);
 await withoutWrites(async()=>{const actual=await readRoom();assert.equal(actual.pokerTables,undefined);});
});
test("missing-room observation cannot overwrite a concurrent creator or its administrator registry",async()=>{
 const c=await rooms();await c.deleteMany({});
 const r=freshRoom();r.version=99;r.marketSymbols={...marketSymbols(),crypto:["BTC"]};r.house=456;
 const original=Collection.prototype.findOne;let intercepted=false;
 const spy=mock.method(Collection.prototype,"findOne",async function(this:Collection,...args:Parameters<Collection["findOne"]>){
  const snapshot=await original.apply(this,args);
  if(!intercepted&&this.collectionName==="rooms"&&!snapshot){intercepted=true;await c.insertOne(r);}
  return snapshot;
 });
 try{const actual=await readRoom();assert.equal(actual.version,99);assert.equal(actual.house,456);assert.deepEqual(actual.marketSymbols,r.marketSymbols);assert.equal(await c.countDocuments({}),1);}
 finally{spy.mock.restore();}
});

test("a game wager racing a trade shares the cash fence and cannot spend one wallet twice",async()=>{
 const c=await rooms();await c.deleteMany({});
 const who={id:"game-versus-trade",name:"Race",email:"qa@invalid",admin:false},at=Date.now(),generation="game-trade-fixture";
 await mutate(r=>{
  register(r,who);
  r.cryptoStatus={connected:true,heartbeatSubscribed:true,generation,lastMessage:at,leaseUntil:at+10000};
  applyMarketTick(r,{BTC:{micro:100_000_000,at,cryptoGeneration:generation}},at);
 });
 const input={type:"start" as const,game:"chicken" as const,amount:100000,requestAt:at,requestId:randomUUID()};
 const outcomes=await Promise.allSettled([
  mutate(r=>miniAction(r,who,input,()=>1)),
  mutate(r=>spot(r,who,"BTC","buy",100000,at))
 ]);
 assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);
 const saved=await readRoom(),member=saved.members[0];assert.equal(member.wallet,0);
 assert.equal((saved.miniGames?.length??0)+(member.holdings?.length??0),1);assertRoom(saved);
 if(outcomes[0].status==="fulfilled"){
  await mutate(r=>miniAction(r,who,input,()=>{throw Error("duplicate wager rerolled");}));
  const replayed=await readRoom();assert.equal(replayed.miniGames!.length,1);assert.equal(replayed.members[0].wallet,0);
 }
});
