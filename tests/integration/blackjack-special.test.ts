import {test,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mutate,tickRoom} from '../../lib/store';
import {blackjackMove} from '../../lib/blackjack-store';
import {db,readRoom,closeDatabase} from '../../lib/db';
import {register,assertRoom} from '../../lib/poker';
import {blackjackTablesAction} from '../../lib/blackjack';
import type {Identity} from '../../lib/types';
if(!process.env.MONGODB_DB?.startsWith('fakebucks_test_'))throw new Error('Refusing non-test database');
process.env.MONGODB_DB+='_blackjack_special';
const who:Identity={id:'special',name:'Special',email:'special@test',admin:false};
beforeEach(async()=>{await(await db()).dropDatabase();});
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
async function setup(player:string[],dealer:string[],tail:string[]=[]){
 const now=Date.now();
 await mutate(r=>{
  register(r,who,now);blackjackTablesAction(r,who,{type:'join',tableId:'lounge',seat:0},now);
  blackjackTablesAction(r,who,{type:'bet',tableId:'lounge',amount:200,chips:[100,100]},now);
  r.blackjackTables!.tables.lounge!.shoe=[...Array(180).fill('2s'),...[player[0],dealer[0],player[1],dealer[1],...tail].reverse()];
 });
 return now;
}
for(const [player,dealer,payout] of [
 [['7s','8c'],['As','Kh'],500],
 [['7s','8c'],['8s','7c'],200],
 [['As','Kh'],['7s','8c'],0],
 [['7h','8c'],['As','Kh'],0],
 [['9s','Ac'],['7s','8c'],0],
] as [string[],string[],number][])test('persistent initial '+player.join(' ')+' vs '+dealer.join(' ')+' with concurrent tick pays '+payout+' once',async()=>{
 const original=Date.now,now=await setup(player,dealer);
 try{
  Date.now=()=>now+10000;await Promise.all(Array.from({length:6},()=>tickRoom()));await closeDatabase();
  let r=await readRoom();assert.equal(r.members[0].wallet,100000-200+payout);assert.equal(r.house,200-payout);
  assert.equal(r.blackjackTables!.tables.lounge!.seats[0]!.hands[0].payout,payout);assertRoom(r);
  await Promise.all(Array.from({length:6},()=>tickRoom()));r=await readRoom();assert.equal(r.members[0].wallet,100000-200+payout);assertRoom(r);
 }finally{Date.now=original;}
});
test('persisted Charlie uses real move receipt replay and CAS to pay 1:1 only once after fifth card',async()=>{
 const original=Date.now,now=await setup(['2s','3c'],['Ts','9h'],['2h','3h','4s']);
 try{
  Date.now=()=>now+10000;await tickRoom();
  for(let i=0;i<3;i++){
   Date.now=()=>now+10001+i;
   const b=(await readRoom()).blackjackTables!.tables.lounge!;
   const input={type:'hit' as const,tableId:'lounge' as const,round:b.round,deadline:b.deadline,requestId:randomUUID(),requestAt:Date.now()};
   await Promise.all(Array.from({length:5},()=>blackjackMove(who,input)));
  }
  await closeDatabase();const r=await readRoom(),b=r.blackjackTables!.tables.lounge!,h=b.seats[0]!.hands[0];
  assert.equal(b.phase,'settled');assert.equal(h.cards.length,5);assert.equal(h.result,'charlie');assert.equal(h.payout,400);
  assert.equal(r.members[0].wallet,100200);assert.equal(r.house,-200);assertRoom(r);
 }finally{Date.now=original;}
});
