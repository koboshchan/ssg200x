import {test,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {MongoClient} from "mongodb";
import {chargePokerThrow} from "../../runtime/poker-throw-payment.mjs";
import {createPokerTaunts} from "../../runtime/poker-taunts.mjs";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw Error("Isolated test DB required");
const client=new MongoClient(process.env.MONGODB_URI!);
const db=client.db(process.env.MONGODB_DB+"_tablethrows"),collection=db.collection<any>("rooms"),auditCollection=db.collection<any>("audit");
after(async()=>{await db.dropDatabase();await client.close();});
const publicId=(id:string)=>createHash("sha256").update(id).digest("hex").slice(0,16);
async function setup(){
 await collection.deleteMany({});await auditCollection.deleteMany({});
 const room:any={_id:"main",version:0,house:0,members:[{id:"a",wallet:100000},{id:"b",wallet:100000},{id:"c",wallet:100000}],seats:Array(12).fill(null),pokerTables:{"02":{seats:Array(12).fill(null)},"03":{seats:Array(12).fill(null)}}};
 room.seats[0]={userId:"c"};room.pokerTables["02"].seats[10]={userId:"a"};room.pokerTables["02"].seats[11]={userId:"b"};
 await collection.insertOne(room);
 return {tableId:"02",kind:"throw",value:"egg",target:11,targetId:publicId("b"),requestId:randomUUID(),requestAt:100000,expectedPrice:5000};
}
const pay=(payload:any,user="a",now=100000)=>chargePokerThrow({collection,auditCollection,user,payload,authorize:async()=>{},now:()=>now});
test("real Mongo thirty concurrent exact retries charge table02 seat11 once with one durable audit; altered table/index/source cannot replay",async()=>{
 const p=await setup(),before=await collection.findOne({_id:"main"});
 const results=await Promise.all(Array.from({length:30},()=>pay(p)));
 assert.equal(results.filter(r=>!r.replayed).length,1);
 const saved=(await collection.findOne({_id:"main"}))!;
 assert.equal(saved.house,5000);assert.equal(saved.members[0].wallet,95000);assert.equal(saved.members[1].wallet,100000);
 assert.deepEqual(saved.seats,before!.seats);assert.deepEqual(saved.pokerTables,before!.pokerTables);
 assert.equal(saved.pokerThrowReceipts.length,1);assert.equal(saved.auditPending.length,1);assert.equal(await auditCollection.countDocuments({}),1);
 for(const patch of [{tableId:"01"},{tableId:"03"},{target:10}])await assert.rejects(pay({...p,...patch}),/invalid/);
 await assert.rejects(pay(p,"c"),/invalid/);
 assert.equal((await pay(p)).replayed,true);
 // Move the same source into another table. Its durable cooldown is still global.
 await collection.updateOne({_id:"main"},{$set:{"pokerTables.02.seats.10":null,"pokerTables.03.seats.10":{userId:"a"},"pokerTables.03.seats.11":{userId:"b"}},$inc:{version:1}});
 await assert.rejects(pay({...p,requestId:randomUUID(),tableId:"03"}),/cooldown/);
 assert.equal((await pay({...p,requestId:randomUUID(),tableId:"03"}, "a",104000)).replayed,false);
 assert.equal((await collection.findOne({_id:"main"}))!.house,10000);
});
test("real Mongo nested source membership and target bounds forbid cross-table charges",async()=>{
 const p=await setup();
 for(const patch of [{tableId:"01",target:0,targetId:publicId("c")},{tableId:"03"},{tableId:"04"},{target:12},{target:-1}])await assert.rejects(pay({...p,...patch}));
 const r=(await collection.findOne({_id:"main"}))!;assert.equal(r.house,0);assert.equal(r.version,0);assert.equal(await auditCollection.countDocuments({}),0);
});
test("real Mongo socket events only reach selected table viewers with seat10 source and seat11 target",async()=>{
 const p=await setup(),events:any[]=[],sockets=new Map<string,any>(),handlers=new Map<string,any>();
 const attach=createPokerTaunts({collection,auditCollection,io:{sockets:{sockets}},checkSession:async()=>{},checkTab:()=>null,now:()=>100000});
 for(const [id,tableId] of [["a","02"],["b","02"],["c","01"],["spectator","03"]]){
  const s:any={connected:true,data:{identity:{id},expires:200000,marketRoute:"/poker",pokerTableId:tableId},handshake:{auth:{}},on:(_:string,h:any)=>handlers.set(id,h),emit:(_:string,event:any)=>events.push({id,event}),disconnect(){}};
  sockets.set(id,s);attach(s);
 }
 const result:any=await new Promise(resolve=>handlers.get("a")(p,resolve));
 assert.equal(result.ok,true);assert.deepEqual(events.map(x=>x.id).sort(),["a","b"]);
 assert.ok(events.every(x=>x.event.tableId==="02"&&x.event.source===10&&x.event.target===11));
 assert.equal((await collection.findOne({_id:"main"}))!.house,5000);
});
test("real Mongo CAS conflict rechecks nested seat replacement before charging",async()=>{
 const p=await setup();let conflict=true;
 const wrapped={findOne:(...args:any[])=>collection.findOne(args[0],args[1]),updateOne:async(q:any,u:any)=>{
  if(conflict){conflict=false;await collection.updateOne({_id:"main"},{$set:{"pokerTables.02.seats.11":{userId:"c"}},$inc:{version:1}});}
  return collection.updateOne(q,u);
 }};
 await assert.rejects(chargePokerThrow({collection:wrapped,auditCollection,user:"a",payload:p,authorize:async()=>{},now:()=>100000}),/target/);
 const r=(await collection.findOne({_id:"main"}))!;
 assert.equal(r.house,0);assert.equal(r.members[0].wallet,100000);assert.equal(r.pokerThrowReceipts,undefined);assert.equal(await auditCollection.countDocuments({}),0);
});
