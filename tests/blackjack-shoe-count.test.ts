import test from 'node:test';
import assert from 'node:assert/strict';
import {freshRoom,register} from '../lib/poker';
import {blackjackTablesAction as act,blackjackTablesTick as tick,blackjackTablesPublic as pub,BLACKJACK_TABLE_IDS,type BlackjackTablesState} from '../lib/blackjack';
import type {Room,Identity} from '../lib/types';
const who:Identity={id:'shoe-player',name:'Player',email:'shoe@test',admin:true};
function setup(id:typeof BLACKJACK_TABLE_IDS[number]='lounge'){
 const r=freshRoom() as Room&{blackjackTables?:BlackjackTablesState};register(r,who,0);
 act(r,who,{tableId:id,type:'join',seat:0},0);return {r,b:r.blackjackTables!.tables[id]!};
}
test('all three lazy six-deck shoes expose 312 without persisting or leaking shoe arrays',()=>{
 const r=freshRoom();register(r,who,0);const before=JSON.stringify(r),p=pub(r,who);
 assert.deepEqual(p.tables.map(t=>t.cardsRemaining),[312,312,312]);assert.equal(JSON.stringify(r),before);
 for(const t of p.tables){assert.equal(typeof t.cardsRemaining,'number');assert.ok(!('shoe' in t));assert.ok(!('privateCards' in t));}
});
test('each table reports its own shared shoe through deal, hit, settlement and betting reset',()=>{
 for(const id of BLACKJACK_TABLE_IDS){
  const {r,b}=setup(id);
  b.shoe=[...Array(180).fill('2s'),...['2h','Ts','3c','7d','4c'].reverse()];
  act(r,who,{tableId:id,type:'bet',amount:100},0);assert.equal(pub(r,who).tables.find(t=>t.id===id)!.cardsRemaining,185);
  tick(r,10000);let t=pub(r,who).tables.find(t=>t.id===id)!;
  assert.equal(t.cardsRemaining,181);assert.deepEqual(t.dealer.cards,['Ts','?']);
  act(r,who,{tableId:id,type:'hit'},10001);assert.equal(pub(r,who).tables.find(t=>t.id===id)!.cardsRemaining,180);
  act(r,who,{tableId:id,type:'stand'},10002);assert.equal(b.phase,'settled');
  assert.equal(pub(r,who).tables.find(t=>t.id===id)!.cardsRemaining,180);
  tick(r,15002);assert.equal(pub(r,who).tables.find(t=>t.id===id)!.cardsRemaining,180);
  assert.ok(pub(r,who).tables.filter(t=>t.id!==id).every(t=>t.cardsRemaining===312));
 }
});
test('reshuffle replaces depleted shoe and publishes the post-deal count',()=>{
 const {r,b}=setup();b.shoe=Array(155).fill('2s');b.round=4;
 assert.equal(pub(r,who).tables[0].cardsRemaining,155);
 act(r,who,{tableId:'lounge',type:'bet',amount:100},0);tick(r,10000);
 assert.equal(b.round,5);assert.ok(b.shoe.length<=308&&b.shoe.length>=297);
 assert.equal(pub(r,who).tables[0].cardsRemaining,b.shoe.length);
});
test('an actually exhausted existing shoe is zero, not the initial 312 placeholder',()=>{
 const {r,b}=setup();b.round=1;b.shoe=[];assert.equal(pub(r,who).tables[0].cardsRemaining,0);
});
