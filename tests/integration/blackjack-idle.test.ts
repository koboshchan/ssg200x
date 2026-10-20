import {test,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mutate,tickRoom} from '../../lib/store';
import {blackjackMove} from '../../lib/blackjack-store';
import {db,readRoom,closeDatabase} from '../../lib/db';
import {register,assertRoom} from '../../lib/poker';
import {blackjackTablesAction,blackjackTablesTick} from '../../lib/blackjack';
import type {Identity} from '../../lib/types';
if(!process.env.MONGODB_DB?.startsWith('fakebucks_test_'))throw new Error('Refusing non-test database');
process.env.MONGODB_DB+='_blackjack_idle';
const who:Identity={id:'idle',name:'Idle',email:'idle@test',admin:false};
beforeEach(async()=>{await(await db()).dropDatabase();});
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
async function seat(now:number){
 await mutate(r=>{register(r,who,now);blackjackTablesAction(r,who,{type:'join',tableId:'lounge',seat:0},now);});
 return readRoom();
}
test('persisted no-bet deadline expires through tickRoom after DB reconnect with no round deadline or money changes',async()=>{
 const original=Date.now,now=original();await seat(now);await closeDatabase();
 try{
  Date.now=()=>now+299999;await tickRoom();let r=await readRoom();assert.ok(r.blackjackTables!.tables.lounge!.seats[0]);
  const wallets=r.members.map(m=>m.wallet),house=r.house;
  Date.now=()=>now+300000;await Promise.all(Array.from({length:6},()=>tickRoom()));
  r=await readRoom();assert.equal(r.blackjackTables!.tables.lounge!.seats[0],null);
  assert.deepEqual(r.members.map(m=>m.wallet),wallets);assert.equal(r.house,house);assertRoom(r);
 }finally{Date.now=original;}
});
test('real bet endpoint at exact idle boundary rejects and cannot debit wallet while concurrent ticks remove seat',async()=>{
 const original=Date.now,now=original();await seat(now);
 try{
  Date.now=()=>now+300000;
  const results=await Promise.allSettled([blackjackMove(who,{type:'bet',tableId:'lounge',amount:100,requestAt:Date.now(),requestId:randomUUID()}),...Array.from({length:4},()=>tickRoom())]);
  assert.equal(results[0].status,'rejected');const r=await readRoom();assert.equal(r.blackjackTables!.tables.lounge!.seats[0],null);assert.equal(r.members[0].wallet,100000);assert.equal(r.house??0,0);assertRoom(r);
 }finally{Date.now=original;}
});
test('bet one millisecond before expiry is persisted once across request replay and restart',async()=>{
 const original=Date.now,now=original();await seat(now);
 try{
  Date.now=()=>now+299999;const request={type:'bet' as const,tableId:'lounge' as const,amount:100,requestAt:Date.now(),requestId:randomUUID()};
  await Promise.all(Array.from({length:4},()=>blackjackMove(who,request)));await closeDatabase();
  Date.now=()=>now+300000;await tickRoom();const r=await readRoom(),s=r.blackjackTables!.tables.lounge!.seats[0]!;
  assert.equal(s.bet,100);assert.equal(s.idleDeadline,now+599999);assert.equal(r.members[0].wallet,99900);assertRoom(r);
 }finally{Date.now=original;}
});
test('forced CAS bet versus idle expiry rechecks both commit orders and never duplicates a debit',async()=>{
 for(const expiryFirst of [true,false]){
  await(await db()).dropDatabase();const now=Date.now();await seat(now);
  let entered!:()=>void,release!:()=>void,first=true;
  const reading=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const delayed=mutate(async r=>{
   if(first){first=false;entered();await gate;}
   if(expiryFirst)blackjackTablesAction(r,who,{type:'bet',tableId:'lounge',amount:100},now+299999);
   else blackjackTablesTick(r,now+300000);
  });
  const outcome=delayed.then(()=>true,()=>false);await reading;
  if(expiryFirst)await mutate(r=>blackjackTablesTick(r,now+300000));
  else await mutate(r=>blackjackTablesAction(r,who,{type:'bet',tableId:'lounge',amount:100},now+299999));
  release();assert.equal(await outcome,!expiryFirst);
  const r=await readRoom(),s=r.blackjackTables!.tables.lounge!.seats[0];
  if(expiryFirst){assert.equal(s,null);assert.equal(r.members[0].wallet,100000);}
  else{assert.equal(s!.bet,100);assert.equal(r.members[0].wallet,99900);assert.equal(s!.idleDeadline,now+599999);}
  assert.equal(r.house??0,0);assertRoom(r);
 }
});
