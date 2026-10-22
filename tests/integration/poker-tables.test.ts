import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {db,readRoom,rooms,closeDatabase} from '../../lib/db';
import {register,assertRoom,totalChips} from '../../lib/poker';
import {move} from '../../lib/store';
import {pokerTableRoom,seatedPokerTable} from '../../lib/poker-tables';
if(!process.env.MONGODB_DB?.startsWith('fakebucks_test_'))throw Error('Isolated test DB required');
process.env.MONGODB_DB+='_tables';
after(async()=>{await(await db()).dropDatabase();await closeDatabase()});
test('concurrent cross-table joins serialize one wallet, reject duplicate seats, persist after reopening',async()=>{
 const r=await readRoom(),who={id:'cas-table',name:'CAS',email:'qa@invalid',admin:false};register(r,who);await(await rooms()).replaceOne({_id:'main'},r);
 const at=Date.now();
 const results=await Promise.allSettled(['02','03'].map((id,i)=>move(who,{type:'join',seat:0,buyIn:20000},'cas-'+i,0,null,at,id as '02'|'03')));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected').length,1);
 const saved=await readRoom(),id=seatedPokerTable(saved,who.id)!;assert.ok(id==='02'||id==='03');assert.equal(saved.members[0].wallet,80000);assert.equal(totalChips(saved),100000);assertRoom(saved);
 const before=structuredClone(saved);await closeDatabase();const reopened=await readRoom();assert.deepEqual(reopened,before);
 // Retried transport receipt cannot debit twice, even with another table context.
 await move(who,{type:'join',seat:1,buyIn:20000},saved.receipts[0].id,0,null,Date.now(),id);
 assert.equal((await readRoom()).members[0].wallet,80000);
 await move(who,{type:'leave'},'leave',0,null,Date.now(),id);
 const out=await readRoom();assert.equal(out.members[0].wallet,100000);assert.equal(pokerTableRoom(out,id).seats[0],null);assertRoom(out);
});

test('existing live eight-seat tables expand append-only with CAS fencing and unchanged hands',async()=>{
 const r=await readRoom();
 for(const [t,id] of (['01','02','03'] as const).entries()){
  for(let i=0;i<2;i++){
   const who={id:`upgrade-${t}-${i}`,name:'Upgrade',email:'qa@invalid',admin:false};register(r,who);
   const table=pokerTableRoom(r,id);const {applyPokerTableAction}=await import('../../lib/poker-tables');
   applyPokerTableAction(r,id,who,{type:'join',seat:i===0?0:7,buyIn:20000},table.handNumber,table.deadline,Date.now());
  }
  for(let i=0;i<2;i++){
   const table=pokerTableRoom(r,id);const {applyPokerTableAction}=await import('../../lib/poker-tables');
   applyPokerTableAction(r,id,{id:`upgrade-${t}-${i}`,name:'Upgrade',email:'qa@invalid',admin:false},{type:'ready'},table.handNumber,table.deadline,Date.now());
  }
 }
 r.seats=r.seats.slice(0,8);for(const id of ['02','03'] as const)r.pokerTables![id]!.seats=r.pokerTables![id]!.seats.slice(0,8);
 r.version=100;const before=structuredClone(r);const c=await rooms();await c.replaceOne({_id:'main'},r);
 const copies=await Promise.all(Array.from({length:8},()=>readRoom()));
 for(const copy of copies){
  assert.equal(copy.version,103);
  for(const id of ['01','02','03'] as const){
   const old=pokerTableRoom(before,id),next=pokerTableRoom(copy,id);assert.equal(next.seats.length,12);assert.deepEqual(next.seats.slice(0,8),old.seats);assert.deepEqual(next.seats.slice(8),[null,null,null,null]);
   for(const key of ['button','handNumber','turn','deadline','pending','deck','board','currentBet','minRaise'] as const)assert.deepEqual(next[key],old[key]);
  }
  assert.equal(totalChips(copy),totalChips(before));assertRoom(copy);
 }
 assert.equal((await c.replaceOne({_id:'main',version:100},before)).matchedCount,0);
});
