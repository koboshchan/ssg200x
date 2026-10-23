import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db,rooms,readRoom,closeDatabase} from "../lib/db";
import {freshRoom,register,totalChips,assertRoom} from "../lib/poker";
import {rouletteState,rouletteTick,roulettePublic,rouletteAction} from "../lib/roulette";
import {rouletteMove} from "../lib/roulette-store";
import {rouletteAudit} from "../lib/roulette-audit";
import {mutate} from "../lib/store";
import type {AuditEvent} from "../lib/types";
const a={id:"qa-a",name:"Alice",email:"a@example.test",admin:false},b={...a,id:"qa-b",name:"Bob"};
const request=()=>({id:randomUUID(),at:Date.now()});
async function seed(){const r=freshRoom();register(r,a);register(r,b);rouletteState(r,Date.now());await(await rooms()).replaceOne({_id:"main"},r,{upsert:true});await(await db()).collection("audit").deleteMany({});}
async function main(){
 assert.match(process.env.MONGODB_DB||"",/^ssg_qa_roulette_600b2893_[a-z0-9]+$/);
 await seed();
 const req=request();
 const results=await Promise.all(Array.from({length:5},()=>rouletteMove(a,{type:"bet",bet:{kind:"red",amount:300}},1,req.id,req.at)));
 let r=await readRoom();assert.equal(r.members[0].wallet,99700);assert.equal(rouletteState(r,0).bets.length,1);
 assert.equal((await rouletteAudit({...a,admin:true},r.members[0].publicId)).events.length,1);
 await assert.rejects(()=>rouletteAudit(a),{status:403});
 assert.equal((await rouletteAudit({...b,admin:true},r.members[1].publicId)).events.length,0);
 for(const result of results)assert.doesNotMatch(JSON.stringify(roulettePublic(result,a)),/"dead"|"auditPending"/);
 // Audit flush failure fallback reads only committed queue, admin-only.
 const durable=await(await db()).collection<AuditEvent>("audit").find({}).toArray();
 await(await rooms()).updateOne({_id:"main"},{$set:{auditPending:durable}});
 await(await db()).collection("audit").deleteMany({});
 assert.equal((await rouletteAudit({...a,admin:true})).events.length,1);
 const dup=await rouletteMove(a,{type:"bet",bet:{kind:"red",amount:300}},1,req.id,req.at);
 for(const [action,round,at] of [
 [{type:"bet",bet:{kind:"red",amount:500}},1,req.at],
 [{type:"bet",bet:{kind:"red",amount:300}},2,req.at],
 [{type:"bet",bet:{kind:"red",amount:300}},1,req.at+1]
 ] as const){const before=JSON.stringify(await readRoom());await assert.rejects(()=>rouletteMove(a,action,round,req.id,at),{status:409});assert.equal(JSON.stringify(await readRoom()),before);}

 assert.equal(dup.members[0].wallet,99700);assert.equal(rouletteState(dup,0).bets[0].bet.amount,300);
 await assert.rejects(()=>rouletteMove(b,{type:"bet",bet:{kind:"red",amount:500}},1,req.id,req.at),{status:409});
 r=await readRoom();const before=JSON.stringify(r);await assert.rejects(()=>rouletteMove(a,{type:"change",betId:req.id,bet:{kind:"red",amount:150}},1,randomUUID(),Date.now()));assert.equal(JSON.stringify(await readRoom()),before);
 const bank=totalChips(r);
 const normal=request();await rouletteMove(b,{type:"bet",bet:{kind:"red",amount:500}},1,normal.id,normal.at);
 await mutate(room=>{rouletteState(room,0).started=Date.now()-60000;rouletteTick(room,Date.now(),()=>1);});
 r=await readRoom();assert.equal(r.members[0].wallet,99700);assert.equal(r.members[1].wallet,100500);assert.equal(totalChips(r),bank);assertRoom(r);
 // Reload persisted metadata and settle at most once under a retried tick.
 const snapshot=JSON.stringify(r);await mutate(room=>rouletteTick(room,Date.now(),()=>1));r=await readRoom();assert.equal(r.members[0].wallet,99700);assert.equal(r.members[1].wallet,100500);
 // Force an aborted mutation after a flagged wager: neither debit nor audit can escape.
 const pendingBefore=(await(await db()).collection<AuditEvent>("audit").find({}).toArray()).length;
 const wallet=r.members[0].wallet;
 await assert.rejects(()=>mutate(room=>{const state=rouletteState(room,0);delete state.spin;state.started=Date.now();rouletteAction(room,a,{type:"bet",bet:{kind:"red",amount:300}},state.round,randomUUID(),Date.now());throw new Error("rollback");}));
 assert.equal((await readRoom()).members[0].wallet,wallet);assert.equal((await(await db()).collection<AuditEvent>("audit").find({}).toArray()).length,pendingBefore);
 // Legit clicks raced with identical delivery never aggregate; repeat copies each original default chip.
 await seed();const clicks=[request(),request(),request()];
 await Promise.all(clicks.flatMap(q=>[0,1].map(()=>rouletteMove(a,{type:"bet",bet:{kind:"red",amount:100}},1,q.id,q.at))));
 r=await readRoom();assert.equal(r.members[0].wallet,99700);assert.deepEqual(rouletteState(r,0).bets.map(w=>w.bet.amount),[100,100,100]);
 await mutate(room=>{const state=rouletteState(room,0);const end=state.started+60000;rouletteTick(room,end,()=>1);rouletteTick(room,end+17000,()=>1);state.started=Date.now();});
 const repeat=request();await Promise.all(Array.from({length:4},()=>rouletteMove(a,{type:"rebet"},2,repeat.id,repeat.at)));
 r=await readRoom();assert.deepEqual(rouletteState(r,0).bets.map(w=>w.bet.amount),[100,100,100]);assert.equal(r.members[0].wallet,100000);
 assert.ok(rouletteState(r,0).bets.every(w=>!w.dead));assert.equal((await rouletteAudit({...a,admin:true})).events.length,0);assertRoom(r);
 // Change/cancel races serialize through existing CAS and never duplicate refunds.
 const w=rouletteState(r,0).bets[0],cancel=request();
 await Promise.all(Array.from({length:3},()=>rouletteMove(a,{type:"cancel",betId:w.id},2,cancel.id,cancel.at)));
 assert.equal((await readRoom()).members[0].wallet,100100);
 console.log("Mongo CAS/idempotence/rollback/private audit/reload/dead settlement/legit rebet/cancel PASS");
}
main().finally(closeDatabase).catch(e=>{console.error(e);process.exitCode=1;});
