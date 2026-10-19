import test from 'node:test';
import assert from 'node:assert/strict';
import {freshRoom,register} from '../lib/poker';
import {blackjackAction as act,blackjackTick as tick,blackjackAssets as assets,blackjackPublic as pub,blackjackValue as val,blackjackShoe, type BlackjackState} from '../lib/blackjack';
import type {Room,Identity} from '../lib/types';
const a:Identity={id:'a',name:'A',email:'a@test',admin:true},b:Identity={id:'b',name:'B',email:'b@test',admin:true};
function setup(two=false){const r=freshRoom() as Room&{blackjack:BlackjackState};register(r,a,0);act(r,a,{type:'join',seat:0},0);if(two){register(r,b,0);act(r,b,{type:'join',seat:1},0);}return r;}
function bank(r:Room){return r.members.reduce((n,m)=>n+m.wallet,0)+assets(r)+(r.house??0);}
function rig(r:ReturnType<typeof setup>,cards:string[]){r.blackjack.shoe=[...Array(180).fill('2s'),...cards.slice().reverse()];}
function bet(r:Room,w=a,amount=100){act(r,w,{type:'bet',amount},0);}
test('six decks, unbiased shuffle injection and ace totals',()=>{const s=blackjackShoe(max=>max-1);assert.equal(s.length,312);assert.equal(s.filter(c=>c==='As').length,6);assert.equal(val(['As','Ah','9s']),21);assert.equal(val(['As','6h']),17);assert.equal(val(['Ks','Qh','2c']),22);});
test('bet replacement/refund, approved checks, idle and seats',()=>{const r=setup();const n=bank(r);bet(r);bet(r,a,200);assert.equal(assets(r),200);assert.equal(bank(r),n);assert.equal(r.blackjack.deadline,10000);act(r,a,{type:'leave'},1);assert.equal(bank(r),n);assert.equal(assets(r),0);assert.equal(r.blackjack.deadline,null);tick(r,100000);assert.equal(r.blackjack.phase,'betting');register(r,{...b,admin:false},0);assert.throws(()=>act(r,b,{type:'join',seat:1},0));assert.throws(()=>act(r,a,{type:'join',seat:6},0));});
test('natural pays 3:2, settled escrow cleared exactly once',()=>{const r=setup(),n=bank(r);rig(r,['As','9h','Ks','8h']);bet(r);tick(r,9999);assert.equal(r.blackjack.phase,'betting');tick(r,10000);assert.equal(r.blackjack.phase,'settled');assert.equal(r.members[0].wallet,100150);assert.equal(r.house,-150);assert.equal(assets(r),0);assert.equal(bank(r),n);tick(r,10001);assert.equal(bank(r),n);tick(r,15000);assert.equal(r.blackjack.phase,'betting');assert.equal(r.blackjack.deadline,null);});
test('dealer natural ends immediately; naturals push',()=>{for(const cards of [['9s','As','8s','Kh'],['As','As','Ks','Kh']]){const r=setup(),n=bank(r);rig(r,cards);bet(r);tick(r,10000);assert.equal(r.blackjack.phase,'settled');assert.equal(bank(r),n);assert.equal(r.members[0].wallet,cards[0]==='As'?100000:99900);}});
test('shared dealer, turn ownership, privacy, timer auto stand and S17',()=>{const r=setup(true),n=bank(r);rig(r,['Ts','9s','As','8h','8c','6h']);bet(r);bet(r,b);tick(r,10000);const view=pub(r,b)!;assert.deepEqual(view.dealer,['As','??']);assert.equal(view.dealerTotal,null);assert.equal(view.canAct,false);assert.ok(!JSON.stringify(view).includes('shoe'));assert.ok(!JSON.stringify(view).includes('userId'));assert.throws(()=>act(r,b,{type:'hit'},10001));tick(r,40000);assert.equal(r.blackjack.turn,1);tick(r,70000);assert.equal(r.blackjack.phase,'settled');assert.equal(r.blackjack.dealer.length,2);assert.equal(r.members[0].wallet,100100);assert.equal(r.members[1].wallet,100000);assert.equal(bank(r),n);});
test('double debits extra stake, resolves win and preserves ledger',()=>{const r=setup(),n=bank(r);rig(r,['5s','Ts','6h','7h','Ks']);bet(r);tick(r,10000);act(r,a,{type:'double'},10001);assert.equal(r.members[0].wallet,100200);assert.equal(r.blackjack.seats[0]!.hands[0].bet,200);assert.equal(bank(r),n);});
test('hit bust loses without unnecessary dealer draws',()=>{const r=setup(),n=bank(r);rig(r,['Ts','2s','6h','3h','Ks']);bet(r);tick(r,10000);act(r,a,{type:'hit'},10001);assert.equal(r.blackjack.seats[0]!.hands[0].result,'bust');assert.equal(r.blackjack.dealer.length,2);assert.equal(bank(r),n);});
test('split aces one card each, split 21 pays only 1:1',()=>{const r=setup(),n=bank(r);rig(r,['As','Ts','Ah','7h','Ks','Qh']);bet(r);tick(r,10000);act(r,a,{type:'split'},10001);assert.equal(r.members[0].wallet,100200);assert.equal(r.blackjack.seats[0]!.hands.length,2);assert.ok(r.blackjack.seats[0]!.hands.every(h=>h.result==='win'));assert.equal(bank(r),n);});
test('split advances hands and forbids resplit',()=>{const r=setup(),n=bank(r);rig(r,['8s','Ts','8h','7h','8c','2h']);bet(r);tick(r,10000);act(r,a,{type:'split'},10001);assert.throws(()=>act(r,a,{type:'split'},10002));act(r,a,{type:'stand'},10003);assert.equal(r.blackjack.hand,1);act(r,a,{type:'stand'},10004);assert.equal(bank(r),n);});
test('leave active round stands hands but retains wager until settlement',()=>{const r=setup(true),n=bank(r);rig(r,['Ts','9s','Ts','8h','8c','7h']);bet(r);bet(r,b);tick(r,10000);act(r,a,{type:'leave'},10001);assert.equal(r.blackjack.turn,1);assert.equal(assets(r),200);act(r,b,{type:'stand'},10002);assert.equal(bank(r),n);tick(r,15002);assert.equal(r.blackjack.seats[0],null);assert.equal(bank(r),n);});
test('bad bets/actions leave wallet intact, finite integer cents only',()=>{const r=setup();for(const amount of [99,101,100001,NaN,Infinity,100.5])assert.throws(()=>bet(r,a,amount));assert.equal(r.members[0].wallet,100000);assert.throws(()=>act(r,a,{type:'double'},0));bet(r);rig(r,['5s','Ts','6h','7h']);tick(r,10000);r.members[0].wallet=0;assert.throws(()=>act(r,a,{type:'double'},10001));assert.equal(assets(r),100);});

import {blackjackTablesAction as tablesAct,blackjackTablesTick as tablesTick,blackjackTablesAssets as tablesAssets,blackjackTablesPublic as tablesPub,type BlackjackTablesState} from '../lib/blackjack';
test('three lobby tables, cross-table seats blocked and all wagers conserved',()=>{
 const r=freshRoom() as Room&{blackjackTables?:BlackjackTablesState};register(r,a,0);register(r,b,0);const n=r.members.reduce((n,m)=>n+m.wallet,0);
 assert.equal(tablesPub(r,a).tables.length,3);assert.equal(r.blackjackTables,undefined);
 tablesAct(r,a,{tableId:'lounge',type:'join',seat:0},0);tablesAct(r,b,{tableId:'salon',type:'join',seat:0},0);
 assert.throws(()=>tablesAct(r,a,{tableId:'terrace',type:'join',seat:0},0));
 tablesAct(r,a,{tableId:'lounge',type:'bet',amount:100},0);tablesAct(r,b,{tableId:'salon',type:'bet',amount:200},0);
 assert.equal(tablesAssets(r),300);assert.equal(r.members.reduce((n,m)=>n+m.wallet,0)+tablesAssets(r)+(r.house??0),n);
 for(const t of Object.values(r.blackjackTables!.tables))t!.shoe=[...Array(180).fill('2s'),...'7h,8s,Ts,9s'.split(',')];
 tablesTick(r,10000);const p=tablesPub(r,a);assert.equal(p.tables[0].legal.stand,true);assert.equal(p.tables[1].legal.stand,false);assert.equal(p.tables[0].dealer.cards[1],'?');assert.equal(JSON.stringify(p).includes('shoe'),false);
 tablesTick(r,40000);assert.equal(tablesAssets(r),0);assert.equal(r.members.reduce((n,m)=>n+m.wallet,0)+tablesAssets(r)+(r.house??0),n);
 tablesAct(r,a,{tableId:'lounge',type:'leave'},40001);tablesAct(r,a,{tableId:'terrace',type:'join',seat:5},40002);
 assert.equal(tablesPub(r,a).tables[2].mySeat,5);
});

import {blackjackMemberAssets} from '../lib/blackjack';
test('per-member assets include only own unsettled bets and doubled/split stakes',()=>{
 const r=freshRoom() as Room&{blackjackTables?:BlackjackTablesState};register(r,a,0);register(r,b,0);
 tablesAct(r,a,{tableId:'lounge',type:'join',seat:0},0);tablesAct(r,b,{tableId:'lounge',type:'join',seat:1},0);
 tablesAct(r,a,{tableId:'lounge',type:'bet',amount:100},0);tablesAct(r,b,{tableId:'lounge',type:'bet',amount:200},0);
 assert.equal(blackjackMemberAssets(r,'a'),100);assert.equal(blackjackMemberAssets(r,'b'),200);assert.equal(blackjackMemberAssets(r,'nobody'),0);
 r.blackjackTables!.tables.lounge!.shoe=[...Array(180).fill('2s'),...['5s','9s','Ts','6h','8c','7h','Ts'].reverse()];
 tablesTick(r,10000);tablesAct(r,a,{tableId:'lounge',type:'double'},10001);
 assert.equal(blackjackMemberAssets(r,'a'),200);assert.equal(blackjackMemberAssets(r,'b'),200);
 tablesAct(r,b,{tableId:'lounge',type:'stand'},10002);assert.equal(blackjackMemberAssets(r,'a'),0);assert.equal(blackjackMemberAssets(r,'b'),0);
});
