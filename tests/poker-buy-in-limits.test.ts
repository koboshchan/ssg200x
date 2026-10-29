import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register,applyAction,assertRoom,totalChips,legal} from "../lib/poker";
import {casinoLimits} from "../lib/casino-limits";
import {adminCasinoSnapshot,changeCasinoLimits} from "../lib/admin-casino-limits";
import {publicRoom} from "../lib/public";
import {actionSchema} from "../lib/schemas";
import {pokerStakes} from "../lib/poker-stakes";
import {applyPokerTableAction,pokerTableRoom,POKER_FIELDS} from "../lib/poker-tables";
const admin={id:"admin",name:"Admin",email:"a@test",admin:true},user={id:"player",name:"Player",email:"p@test",admin:false};
function setup(wallet=1000000){const room=freshRoom();register(room,admin,0);const m=register(room,user,0);room.issuance=wallet-m.wallet;m.adjustments=wallet-m.wallet;m.wallet=wallet;return room;}
const join=(room:ReturnType<typeof setup>,id:'01'|'02'|'03',buyIn:number)=>{const t=pokerTableRoom(room,id);applyPokerTableAction(room,id,user,{type:'join',seat:0,buyIn},t.handNumber,t.deadline,0);};
const base={type:'join',seat:0,requestId:'123e4567-e89b-42d3-a456-426614174000',requestAt:0,handNumber:0,turnDeadline:null};
for(const [id,minBuyIn,maxBuyIn] of [['01',4000,20000],['02',40000,200000],['03',200000,1000000]] as const){
 test(id+' accepts exactly 20–100 BB regardless of old global cap and publishes exact bounds',()=>{
  assert.equal(pokerStakes(id).minBuyIn,20*pokerStakes(id).big);assert.equal(pokerStakes(id).maxBuyIn,100*pokerStakes(id).big);
  for(const legacyCap of [10000,100000,100000000])for(const buyIn of [minBuyIn,maxBuyIn]){
   const room=setup();room.casinoLimits={...casinoLimits(room),pokerMaxBuyIn:legacyCap};const before=totalChips(room);
   join(room,id,buyIn);assert.equal(room.members[1].wallet,1000000-buyIn);assert.equal(pokerTableRoom(room,id).seats[0]!.stack,buyIn);assertRoom(room);
   const view=publicRoom(room,user,id);assert.deepEqual(view.pokerBuyIn,{minBuyIn,maxBuyIn});
   assert.equal(view.pokerTables.find(t=>t.id===id)!.minBuyIn,minBuyIn);assert.equal(view.pokerTables.find(t=>t.id===id)!.maxBuyIn,maxBuyIn);
   assert.ok(actionSchema.safeParse({...base,tableId:id,buyIn}).success);
   const table=pokerTableRoom(room,id);applyPokerTableAction(room,id,user,{type:'leave'},table.handNumber,table.deadline,1);
   assert.equal(room.members[1].wallet,1000000);assert.equal(totalChips(room),before);assertRoom(room);
  }
 });
 test(id+' rejects outside bounds and non-whole dollars in schema and engine without wallet mutation',()=>{
  for(const buyIn of [minBuyIn-100,maxBuyIn+100,minBuyIn+1,minBuyIn+0.5,NaN,Infinity,-100,0]){
   const room=setup(),before=structuredClone(room);
   assert.equal(actionSchema.safeParse({...base,tableId:id,buyIn}).success,false);
   assert.throws(()=>join(room,id,buyIn),/Buy in between/);assert.deepEqual(room,before);
  }
 });
 test(id+' requires enough wallet even for an otherwise valid minimum buy-in',()=>{
  const room=setup(minBuyIn-100),before=structuredClone(room);
  assert.throws(()=>join(room,id,minBuyIn),/wallet/);assert.deepEqual(room,before);assertRoom(room);
 });
}
test('schema defaults to low table, permits $40, rejects $10,001 and enforces explicit selected table',()=>{
 assert.ok(actionSchema.safeParse({...base,buyIn:4000}).success);
 assert.equal(actionSchema.safeParse({...base,tableId:'03',buyIn:1000100}).success,false);
 assert.equal(actionSchema.safeParse({...base,tableId:'03',buyIn:4000}).success,false);
 assert.equal(actionSchema.safeParse({...base,tableId:'04',buyIn:4000}).success,false);
});
test('admin snapshot replaces global poker policy with explicit table bounds; deprecated edits fail without mutation',()=>{
 const room=setup(),snapshot=adminCasinoSnapshot(room,admin);
 assert.equal(snapshot.pokerBuyInPolicy,'table-stakes');assert.deepEqual(snapshot.pokerTableLimits,{'01':{minBuyIn:4000,maxBuyIn:20000},'02':{minBuyIn:40000,maxBuyIn:200000},'03':{minBuyIn:200000,maxBuyIn:1000000}});
 const before=structuredClone(room);
 assert.throws(()=>changeCasinoLimits(room,admin,{rouletteMaxTotal:100,blackjackMaxHand:100,pokerMaxBuyIn:250000,expectedVersion:0}),/no longer editable/);assert.deepEqual(room,before);
 assert.throws(()=>adminCasinoSnapshot(room,user),/Administrator/);
 assert.throws(()=>changeCasinoLimits(room,user,{rouletteMaxTotal:100,blackjackMaxHand:100,expectedVersion:0}),/Administrator/);
 // An older client can echo the old value when saving unrelated settings.
 changeCasinoLimits(room,admin,{rouletteMaxTotal:100,blackjackMaxHand:100,pokerMaxBuyIn:100000,expectedVersion:0});
 assert.equal(casinoLimits(room).rouletteMaxTotal,100);assert.equal(casinoLimits(room).pokerMaxBuyIn,100000);
 changeCasinoLimits(room,admin,{rouletteMaxTotal:200,blackjackMaxHand:200,expectedVersion:1});
 assert.equal(casinoLimits(room).pokerMaxBuyIn,100000);
 const current=structuredClone(room);assert.throws(()=>changeCasinoLimits(room,admin,{rouletteMaxTotal:100,blackjackMaxHand:100,expectedVersion:0}),/changed/);assert.deepEqual(room,current);
});
test('legacy out-of-range seated stacks remain intact and cash out; new join uses new policy',()=>{
 for(const id of ['01','02','03'] as const){
  const room=setup();join(room,id,pokerStakes(id).minBuyIn);
  const table=pokerTableRoom(room,id),s=table.seats[0]!,legacyStack=id==='01'?90000:10000,delta=legacyStack-s.stack;
  s.stack=legacyStack;room.members[1].wallet-=delta;
  const before=structuredClone(table.seats),wallet=room.members[1].wallet;
  changeCasinoLimits(room,admin,{rouletteMaxTotal:100,blackjackMaxHand:100,expectedVersion:0});
  assert.deepEqual(pokerTableRoom(room,id).seats,before);assert.equal(room.members[1].wallet,wallet);assertRoom(room);
  applyPokerTableAction(room,id,user,{type:'leave'},table.handNumber,table.deadline,1);
  assert.equal(room.members[1].wallet,1000000);assert.throws(()=>join(room,id,legacyStack),/Buy in between/);assertRoom(room);
 }
});
test('direct legacy Table 01 actions use its new bounds instead of the old shared max',()=>{
 const room=setup();room.casinoLimits={...casinoLimits(room),pokerMaxBuyIn:10000};
 applyAction(room,user,{type:'join',seat:0,buyIn:20000},0);assert.equal(room.seats[0]!.stack,20000);assertRoom(room);
});

test('legacy short stacks remain playable through an active high-table hand and cash out conserved winnings',()=>{
 for(const id of ['02','03'] as const){
  const room=freshRoom(),users=[admin,user,{...user,id:'legacy-third'}];
  const action=(i:number,a:Parameters<typeof applyPokerTableAction>[3])=>{const t=pokerTableRoom(room,id);applyPokerTableAction(room,id,users[i],a,t.handNumber,t.deadline,0);assertRoom(room);};
  for(const [i,who] of users.entries()){
   const m=register(room,who,0),extra=1000000-m.wallet;m.wallet+=extra;m.adjustments=extra;room.issuance=(room.issuance??0)+extra;
   action(i,{type:'join',seat:i,buyIn:pokerStakes(id).minBuyIn});
   // Existing $200 stacks are not topped up, rejected or truncated by the new join policy.
   const seat=pokerTableRoom(room,id).seats[i]!;m.wallet+=seat.stack-20000;seat.stack=20000;
  }
  for(let i=0;i<3;i++)action(i,{type:'ready'});
  assert.equal(pokerTableRoom(room,id).street,'preflop');
  const gameplay=()=>Object.fromEntries(POKER_FIELDS.map(k=>[k,pokerTableRoom(room,id)[k]]));
  const before=structuredClone(gameplay());
  changeCasinoLimits(room,admin,{rouletteMaxTotal:100,blackjackMaxHand:100,expectedVersion:0});
  assert.deepEqual(gameplay(),before);
  assert.throws(()=>action(0,{type:'leave'}),/hand/);
  let turns=0;
  while(pokerTableRoom(room,id).street!=='showdown'&&turns++<30){const t=pokerTableRoom(room,id),i=t.turn!;action(i,{type:legal(t,i)!.check?'check':'call'});}
  assert.equal(pokerTableRoom(room,id).street,'showdown');
  for(let i=0;i<3;i++)if(pokerTableRoom(room,id).seats[i])action(i,{type:'leave'});
  assert.equal(totalChips(room),3000000);assert.equal(room.members.reduce((n,m)=>n+m.wallet,0),3000000);assertRoom(room);
 }
});
