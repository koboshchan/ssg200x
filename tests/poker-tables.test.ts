import {pokerStakes} from '../lib/poker-stakes';
import test from 'node:test';
import assert from 'node:assert/strict';
import {freshRoom,register,assertRoom,totalChips,READY_MS,TURN_MS} from '../lib/poker';
import {applyPokerTableAction,pokerTableRoom,seatedPokerTable,tickPokerTables,pokerTableId,pokerMemberAssets} from '../lib/poker-tables';
import {publicRoom} from '../lib/public';
const who=(i:number)=>({id:'table-user-'+i,name:'Player '+i,email:'test@invalid',admin:false});
const now=Date.now();
function setup(){const r=freshRoom();for(let i=0;i<6;i++){const m=register(r,who(i),now);m.wallet+=900000;m.adjustments=900000;r.issuance=(r.issuance??0)+900000;}return r;}
function action(r:ReturnType<typeof freshRoom>,id:'01'|'02'|'03',user:number,a:any,at=now){const t=pokerTableRoom(r,id);applyPokerTableAction(r,id,who(user),a,t.handNumber,t.deadline,at);assertRoom(r);}
test('all three tables keep twelve seats, one global wallet, exclusive membership and independent hands',()=>{
 const r=setup();
 for(let table=0;table<3;table++){const id=['01','02','03'][table] as '01'|'02'|'03';for(let j=0;j<2;j++)action(r,id,table*2+j,{type:'join',seat:j,buyIn:pokerStakes(id).minBuyIn});}
 assert.equal(totalChips(r),6000000);
 assert.equal(seatedPokerTable(r,who(2).id),'02');
 assert.throws(()=>action(r,'03',2,{type:'join',seat:3,buyIn:20000}),/Leave your current/);
 for(const id of ['01','02','03'] as const)assert.equal(pokerTableRoom(r,id).seats.length,12);
 const first=structuredClone(pokerTableRoom(r,'01').seats);
 action(r,'02',2,{type:'ready'});action(r,'02',3,{type:'ready'});
 assert.equal(pokerTableRoom(r,'02').street,'preflop');assert.equal(r.street,'waiting');assert.deepEqual(r.seats,first);
 const live=structuredClone(pokerTableRoom(r,'02'));
 action(r,'03',4,{type:'ready'});action(r,'03',5,{type:'ready'});
 assert.deepEqual(pokerTableRoom(r,'02').seats,live.seats);assert.equal(pokerTableRoom(r,'02').deadline,live.deadline);
 assert.throws(()=>action(r,'01',2,{type:'fold'}),/not seated/);
 const own=publicRoom(r,who(2),'02'),other=publicRoom(r,who(4),'02');
 assert.equal(own.pokerTables[1].seatsFilled,2);assert.equal(own.me.pokerTableId,'02');assert.equal(own.pokerInPlay,40000);
 assert.ok(own.seats[0]!.hole.every(c=>c!=='?'));assert.ok(other.seats[0]!.hole.every(c=>c==='?'));
 assert.equal(pokerMemberAssets(r,who(2).id),40000);assert.equal(own.leaderboard.find(m=>m.publicId===own.me.publicId)!.netWorth,1000000);
 assertRoom(r);
});
test('legacy live Table 01 survives extra-table allocation, and extras persist cash-out and tick state',()=>{
 const r=setup();action(r,'01',0,{type:'join',seat:0,buyIn:20000});action(r,'01',1,{type:'join',seat:1,buyIn:20000});action(r,'01',0,{type:'ready'});action(r,'01',1,{type:'ready'});
 const original=structuredClone(r);
 action(r,'02',2,{type:'join',seat:0,buyIn:40000});action(r,'03',3,{type:'join',seat:0,buyIn:200000});
 const {members,pokerTables,...actual}=r;const {members:oldMembers,...expected}=original;assert.deepEqual(actual,expected);
 action(r,'02',2,{type:'leave'});assert.equal(r.members[2].wallet,1000000);assert.equal(seatedPokerTable(r,who(2).id),null);
 action(r,'03',3,{type:'ready'});tickPokerTables(r,now+READY_MS+1);assertRoom(r);assert.equal(pokerTableRoom(r,'03').seats[0]!.ready,false);assert.equal(pokerTableRoom(r,'03').readyDeadline,null);assert.equal(r.members[3].wallet,800000);
});
test('table IDs fail closed and duplicate seats across tables fail ledger assertions',()=>{
 assert.throws(()=>pokerTableId('04'));assert.throws(()=>pokerTableId({}));const r=setup();action(r,'01',0,{type:'join',seat:0,buyIn:20000});action(r,'02',1,{type:'join',seat:0,buyIn:40000});r.pokerTables!['02']!.seats[0]!.userId=who(0).id;assert.throws(()=>assertRoom(r),/Duplicate/);
});

test('current profile labels resolve independently in extra table logs without changing saved history',async()=>{
 const {roomWithClerkNames}=await import('../runtime/clerk-names.mjs');const r=setup();action(r,'02',2,{type:'join',seat:0,buyIn:40000});
 const raw=r.pokerTables!['02']!.log[0];assert.match(raw,/\[\[player:/);
 const named=roomWithClerkNames(r,new Map([[who(2).id,{name:'New table name',avatar:null}]]));
 assert.match(named.pokerTables!['02']!.log[0],/^New table name takes seat/);assert.equal(r.pokerTables!['02']!.log[0],raw);
});

 test('each table uses a two-minute ready window without changing cashouts or sixty-second turns',()=>{
  assert.equal(READY_MS,120000);assert.equal(TURN_MS,60000);
  for(const id of ['01','02','03'] as const){
   const r=setup();action(r,id,0,{type:'join',seat:0,buyIn:pokerStakes(id).minBuyIn});action(r,id,1,{type:'join',seat:1,buyIn:pokerStakes(id).minBuyIn});action(r,id,0,{type:'ready'});
   assert.equal(pokerTableRoom(r,id).readyDeadline,now+120000);
   tickPokerTables(r,now+119999);assert.ok(pokerTableRoom(r,id).seats[1]);assert.equal(r.members[1].wallet,1000000-pokerStakes(id).minBuyIn);
   tickPokerTables(r,now+120000);const t=pokerTableRoom(r,id);assert.equal(t.seats[1],null);assert.equal(r.members[1].wallet,1000000);assert.equal(t.seats[0]!.stack,pokerStakes(id).minBuyIn);assert.equal(t.seats[0]!.ready,false);assert.equal(t.readyDeadline,null);assert.equal(t.street,'waiting');assert.equal(totalChips(r),6000000);assertRoom(r);
  }
 });
