import {test,before,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {setTimeout as wait} from "node:timers/promises";
import {spawnSync} from "node:child_process";
import {db,readRoom,closeDatabase} from "../../lib/db";
import {dropPlinko,settleDuePlinko} from "../../lib/plinko-store";
import {miniAction,miniSnapshot,miniPayout,type MiniGame} from "../../lib/minigames";
import {assertRoom} from "../../lib/poker";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_plinko_delayed_"))throw Error("Requires own isolated Plinko test DB");
const who={id:"plinko-test",name:"Drop",email:"drop@test",admin:false};
const input=()=>({requestId:randomUUID(),requestAt:Date.now(),type:"start" as const,game:"plinko" as const,amount:100,risk:"medium" as const});
before(async()=>{await(await db()).dropDatabase();await readRoom();});
after(async()=>{await closeDatabase();});
test("eight concurrent drops, duplicate tabs and changed orders persist one debit/path per owner request",async()=>{
 const orders=Array.from({length:8},input);
 const result=await Promise.all(orders.flatMap(order=>[dropPlinko(who,order),dropPlinko(who,order)]));
 let r=await readRoom();assertRoom(r);
 assert.equal(r.miniGames?.length,8);assert.equal(r.members[0].wallet,99200);
 for(let i=0;i<8;i++){
  const a=result[2*i],b=result[2*i+1];assert.equal(a.result,b.result);assert.notEqual(a.result,orders[i].requestId);
  const g:MiniGame=r.miniGames!.find(candidate=>candidate.id===a.result)!;
  assert.equal(g.status,"active");assert.equal(g.payout,0);assert.ok(g.durationMs!>0);
  assert.equal(g.landAt,g.createdAt+g.durationMs!);assert.equal(g.result!.path!.reduce((a,b)=>a+b),g.result!.slot);
 }
 await assert.rejects(dropPlinko(who,{...orders[0],amount:200}),/different order/);
 await assert.rejects(dropPlinko(who,input()),/Wait for a ball/);
 await closeDatabase();r=await readRoom();assert.equal(r.members[0].wallet,99200);
 await settleDuePlinko();r=await readRoom();
 for(const g of r.miniGames!)if(g.landAt!>Date.now())assert.equal(g.status,"active");
 // Client actions cannot claim a pending outcome or force cashout.
 for(const type of ["cashout","step"] as const)assert.throws(()=>miniAction(structuredClone(r),who,{requestId:randomUUID(),requestAt:Date.now(),type,id:r.miniGames![0].id,revision:0}),/automatically/);
 const end=Math.max(...r.miniGames!.map(g=>g.landAt!));
 await wait(Math.max(0,end-Date.now())+20);
 await Promise.all(Array.from({length:8},()=>settleDuePlinko()));
 await closeDatabase();r=await readRoom();assertRoom(r);
 const payout=r.miniGames!.reduce((n,g)=>n+g.payout,0);
 assert.equal(r.members[0].wallet,99200+payout);
 for(const g of r.miniGames!){assert.equal(g.status,"won");assert.equal(g.payout,miniPayout(g));assert.ok(g.settledAt!>=g.landAt!);}
 const before=r.members[0].wallet;
 await Promise.all(orders.map(order=>dropPlinko(who,order)));
 await settleDuePlinko();r=await readRoom();assert.equal(r.members[0].wallet,before);
 assert.equal(await(await db()).collection("audit").countDocuments({what:"minigame-start",who:who.id}),8);
 assert.equal(await(await db()).collection("audit").countDocuments({what:"plinko-settled",who:who.id}),8);
});
test("durable receipts survive result/finance compaction, preserve exact payload and isolate owners",async()=>{
 const order=input(),a=await dropPlinko(who,order);
 const database=await db();
 // Simulate history compaction only after normal timed settlement.
 await wait(a.room.miniGames!.find(candidate=>candidate.id===a.result)!.durationMs!+30);
 await settleDuePlinko();
 const collection=database.collection("rooms");
 await collection.updateOne({_id:"main" as any},{$pull:{miniGames:{id:a.result}},$set:{financeReceipts:[]}} as any);
 const before=(await readRoom()).members[0].wallet;
 const replay=await dropPlinko(who,{...order});assert.equal(replay.result,a.result);
 assert.equal(replay.room.members[0].wallet,before);
 await assert.rejects(dropPlinko(who,{...order,risk:"high" as any}),/different order/);
 const other={...who,id:"other"};
 const b=await dropPlinko(other,order);assert.notEqual(b.result,a.result);
 assert.equal(miniSnapshot(b.room,who).games.some(g=>g.id===b.result),false);
 await database.collection("rooms").updateOne({_id:"main" as any},{$set:{"members.1.accessRevoked":true}});
 await assert.rejects(dropPlinko(other,order),/revoked/);
 assertRoom(await readRoom());
});
test("future drops are untouched by workers; crash before transaction commit leaves no debit or receipt",async()=>{
 const order=input(),database=await db(),r=await readRoom(),before=r.members[0].wallet;
 const source=`import {db} from "./lib/db";import {miniAction} from "./lib/minigames";(async()=>{const d=await db(),s=d.client.startSession();s.startTransaction();const c=d.collection("rooms"),r=await c.findOne({_id:"main"},{session:s});miniAction(r,${JSON.stringify(who)},${JSON.stringify(order)},undefined,true);await c.replaceOne({_id:"main"},r,{session:s});await d.collection("plinkoDrops").insertOne({_id:"uncommitted-crash"}, {session:s});process.kill(process.pid,"SIGKILL");})();`;
 const child=spawnSync(process.execPath,["--import","tsx","-e",source],{cwd:process.cwd(),env:process.env,timeout:20000});
 assert.equal(child.signal,"SIGKILL");
 assert.equal((await readRoom()).members[0].wallet,before);
 assert.equal(await database.collection("plinkoDrops").countDocuments({_id:"uncommitted-crash" as any}),0);
 const accepted=await dropPlinko(who,order),g=accepted.room.miniGames!.find(g=>g.id===accepted.result)!;
 await closeDatabase();await settleDuePlinko();let current=await readRoom();
 if(Date.now()<g.landAt!)assert.equal(current.miniGames!.find(x=>x.id===g.id)!.status,"active");
 await wait(Math.max(0,g.landAt!-Date.now())+40);await closeDatabase();
 await settleDuePlinko();current=await readRoom();
 assert.equal(current.miniGames!.find(x=>x.id===g.id)!.status,"won");assertRoom(current);
});
test("process restart auto-recovers a committed due drop without browsers or client claims",async()=>{
 const order=input(),accepted=await dropPlinko(who,order);
 const g=accepted.room.miniGames!.find(g=>g.id===accepted.result)!;
 const before=accepted.room.members.find(m=>m.id===who.id)!.wallet;
 await closeDatabase();
 await wait(Math.max(0,g.landAt!-Date.now())+20);
 const worker=`import {startPlinkoWorker} from "./lib/plinko-store";import {db} from "./lib/db";(async()=>{startPlinkoWorker();const timeout=setTimeout(()=>process.exit(2),12000);const poll=setInterval(async()=>{const d=await db(),g=await d.collection("plinkoDrops").findOne({"game.id":${JSON.stringify(g.id)}});if(g?.state==="settled"&&await d.collection("audit").countDocuments({what:"plinko-settled",target:${JSON.stringify(g.id)}})===1){clearTimeout(timeout);clearInterval(poll);process.exit(0);}},50);})();`;
 const restarted=spawnSync(process.execPath,["--import","tsx","-e",worker],{cwd:process.cwd(),env:process.env,timeout:15000});
 assert.equal(restarted.status,0,restarted.stderr?.toString());
 let current=await readRoom();const settled=current.miniGames!.find(x=>x.id===g.id)!;
 assert.equal(settled.status,"won");assert.ok(settled.settledAt!>=g.landAt!);
 assert.equal(current.members.find(m=>m.id===who.id)!.wallet,before+settled.payout);
 // Losing the success reply or restarting yet another worker cannot claim again.
 const again=spawnSync(process.execPath,["--import","tsx","-e",worker],{cwd:process.cwd(),env:process.env,timeout:15000});
 assert.equal(again.status,0,again.stderr?.toString());
 current=await readRoom();assertRoom(current);
 assert.equal(current.members.find(m=>m.id===who.id)!.wallet,before+settled.payout);
 assert.equal(await(await db()).collection("audit").countDocuments({what:"plinko-settled",target:g.id}),1);
});

test("poisoned pending batches do not starve later drops or other owners",async()=>{
 const database=await db(),drops=database.collection("plinkoDrops");
 const poison=Array.from({length:65},(_,i)=>({_id:"poison-"+i,owner:who.id,requestId:randomUUID(),fingerprint:"invalid-test",game:{id:"missing-"+i},state:"pending",landAt:Date.now()-10000}));
 await drops.insertMany(poison as any);
 const a=await dropPlinko(who,input()),g=a.room.miniGames!.find(x=>x.id===a.result)!;
 const before=a.room.members.find(m=>m.id===who.id)!.wallet;
 await wait(Math.max(0,g.landAt!-Date.now())+10);
 for(let i=0;i<2;i++){
  await assert.rejects(settleDuePlinko(),AggregateError);
  const r=await readRoom();assertRoom(r);
  assert.equal(r.miniGames!.find(x=>x.id===g.id)!.status,"won");
  assert.equal(r.members.find(m=>m.id===who.id)!.wallet,before+miniPayout(g));
 }
 assert.equal(await drops.countDocuments({_id:{$in:poison.map(x=>x._id)} as any,state:"pending"}),65);
 assert.equal(await database.collection("audit").countDocuments({what:"plinko-settled",target:g.id}),1);
 await drops.deleteMany({_id:{$in:poison.map(x=>x._id)} as any});
});
