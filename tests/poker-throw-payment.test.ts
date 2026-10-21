import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {chargePokerThrow,throwPrice} from "../runtime/poker-throw-payment.mjs";
import {freshRoom,register,applyAction,assertRoom,totalChips} from "../lib/poker";
import {casinoLimits} from "../lib/casino-limits";
import {changeCasinoLimits} from "../lib/admin-casino-limits";
const a={id:"a",name:"Alice",email:"a@example.com",admin:true},b={id:"b",name:"Bob",email:"b@example.com",admin:false};
const publicId=(s:string)=>createHash("sha256").update(s).digest("hex").slice(0,16);
export function setup(){const room=freshRoom();register(room,a);register(room,b);applyAction(room,a,{type:"join",seat:0,buyIn:10000},0);applyAction(room,b,{type:"join",seat:1,buyIn:10000},0);return room;}
function fixture(){let room=setup(),time=100000;const audits:any[]=[];const collection={findOne:async()=>structuredClone(room),updateOne:async(q:any,u:any)=>{if(q.version!==room.version)return {matchedCount:0};Object.assign(room,structuredClone(u.$set));room.version++;return {matchedCount:1};}};const payload=()=>({tableId:"01",kind:"throw",value:"egg",target:1,targetId:publicId("b"),requestId:randomUUID(),requestAt:time,expectedPrice:5000});return {get room(){return room;},collection,payload,audits,next(){time+=4000;},pay:(p:any,authorize=async()=>{})=>chargePokerThrow({collection,auditCollection:{updateOne:async(_q:any,u:any)=>audits.push(u.$setOnInsert)},user:"a",payload:p,authorize,now:()=>time})};}
test("defaults and independently admin-set prices persist, reject unauthorized and preserve older-client edits",()=>{
 const f=fixture();assert.equal(throwPrice(f.room,"egg"),5000);assert.equal(throwPrice(f.room,"tomato"),5000);
 const edit={...casinoLimits(f.room),pokerEggPrice:7500,pokerTomatoPrice:1200,expectedVersion:0};
 assert.throws(()=>changeCasinoLimits(f.room,b,edit),/Administrator/);
 changeCasinoLimits(f.room,a,edit);assert.equal(throwPrice(f.room,"egg"),7500);assert.equal(throwPrice(f.room,"tomato"),1200);
 changeCasinoLimits(f.room,a,{rouletteMaxTotal:100000,blackjackMaxHand:100000,expectedVersion:1});assert.equal(casinoLimits(f.room).pokerEggPrice,7500);
 for(const p of [0,101,-100,Infinity,100000100])assert.throws(()=>changeCasinoLimits(f.room,a,{...edit,pokerEggPrice:p,expectedVersion:2}),/whole dollars/);
});
test("throw debits only thrower wallet, credits house, conserves chips with durable audit and exact replay",async()=>{
 const f=fixture(),p=f.payload(),before=totalChips(f.room),target=f.room.members[1].wallet,stack=f.room.seats[0]!.stack;
 const result=await f.pay(p);assert.equal(result.cost,5000);assert.equal(result.replayed,false);assert.equal(f.room.members[0].wallet,85000);assert.equal(f.room.house,5000);assert.equal(f.room.members[1].wallet,target);assert.equal(f.room.seats[0]!.stack,stack);assert.equal(totalChips(f.room),before);assertRoom(f.room);
 assert.equal(f.audits.length,1);assert.equal(f.room.auditPending!.at(-1)!.what,"poker-throw");
 assert.equal((await f.pay(p)).replayed,true);assert.equal(f.room.house,5000);assert.equal(f.audits.length,1);
 await assert.rejects(f.pay({...p,value:"tomato"}),/invalid/);
});
test("concurrent exact retries charge once; different requests share durable cooldown, including new handler",async()=>{
 const f=fixture(),p=f.payload(),results=await Promise.all(Array.from({length:20},()=>f.pay(p)));
 assert.equal(results.filter(r=>!r.replayed).length,1);assert.equal(f.room.house,5000);
 await assert.rejects(f.pay(f.payload()),/cooldown/);f.next();assert.equal((await f.pay(f.payload())).cost,5000);assert.equal(f.room.house,10000);
});
test("insufficient money, changed price, moved targets, expired requests and auth failure never mutate balances",async()=>{
 for(const mode of ["poor","price","target","expired","auth"]){
  const f=fixture(),p=f.payload();if(mode==="poor")f.room.members[0].wallet=4999;if(mode==="price")p.expectedPrice=100;if(mode==="target")p.targetId=publicId("old");if(mode==="expired")p.requestAt=-200000;
  const before=structuredClone(f.room);await assert.rejects(f.pay(p,async()=>{if(mode==="auth")throw Error("session");}));assert.deepEqual(f.room,before);
 }
});
test("CAS retries reload latest wallet, price, seat and revoke state before charging",async()=>{
 for(const mode of ["price","target","revoke","funds"]){
  const f=fixture(),original=f.collection.updateOne;let conflict=true;
  f.collection.updateOne=async(q:any,u:any)=>{if(conflict){conflict=false;f.room.version++;if(mode==="price")f.room.casinoLimits={...casinoLimits(f.room),pokerEggPrice:10000};if(mode==="target")f.room.seats[1]=null;if(mode==="revoke")f.room.members[0].accessRevoked=true;if(mode==="funds")f.room.members[0].wallet=1;return {matchedCount:0};}return original(q,u);};
  await assert.rejects(f.pay(f.payload()));assert.equal(f.room.house||0,0);assert.equal(f.room.pokerThrowReceipts?.length||0,0);
 }
});

test("nested table twelve-seat payment fingerprints table, target index and authenticated source",async()=>{
 const f=fixture();
 (f.room as any).pokerTables={"02":{seats:Array(12).fill(null)}};
 const seats=(f.room as any).pokerTables["02"].seats;seats[10]=f.room.seats[0];seats[11]=f.room.seats[1];
 f.room.seats[0]=null;f.room.seats[1]=null;
 const p={...f.payload(),tableId:"02",target:11};
 const results=await Promise.all(Array.from({length:30},()=>f.pay(p)));
 assert.equal(results.filter(r=>!r.replayed).length,1);assert.equal(f.room.house,5000);
 for(const patch of [{tableId:"01"},{tableId:"03"},{target:10}])await assert.rejects(f.pay({...p,...patch}),/invalid/);
 assert.equal(f.audits.length,1);assert.equal(f.audits[0].new.tableId,"02");
 assert.equal((await f.pay(p)).replayed,true);
 f.next();await assert.rejects(f.pay({...f.payload(),tableId:"01"}),/not_seated/);
});
