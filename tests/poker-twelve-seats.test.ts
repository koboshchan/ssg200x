import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshRoom,register,assertRoom,totalChips,act,legal} from '../lib/poker';
import {applyPokerTableAction,pokerTableRoom,pokerTablesView} from '../lib/poker-tables';
import {actionSchema} from '../lib/schemas';
import {POKER_SEAT_ORDER} from '../lib/poker-seats';
const who=(n:number)=>({id:'twelve-'+n,name:'Player '+n,email:'qa@invalid',admin:false});
const now=Date.now();
test('three tables independently seat twelve, reject a thirteenth and deal unique private cards',()=>{
 const r=freshRoom();
 for(const [t,id] of (['01','02','03'] as const).entries()){
  for(let i=0;i<12;i++){
   const u=who(t*12+i);register(r,u,now);const table=pokerTableRoom(r,id);
   applyPokerTableAction(r,id,u,{type:'join',seat:i,buyIn:20000},table.handNumber,table.deadline,now);assertRoom(r);
  }
  for(let i=0;i<12;i++){
   const table=pokerTableRoom(r,id);applyPokerTableAction(r,id,who(t*12+i),{type:'ready'},table.handNumber,table.deadline,now);
  }
  const table=pokerTableRoom(r,id);assert.equal(table.street,'preflop');
  const cards=table.seats.flatMap(s=>s?.hole??[]);assert.equal(cards.length,24);assert.equal(new Set(cards).size,24);
  let turns=0;const visited=new Set<number>();
  while(String(table.street)!=='showdown'&&turns++<100){const i=table.turn!;visited.add(i);act(table,table.seats[i]!.userId,{type:legal(table,i)!.check?'check':'call'},now+turns);}
  assert.equal(table.street,'showdown');assert.equal(visited.size,12);assert.equal(table.board.length,5);
 }
 assert.deepEqual(pokerTablesView(r).map(t=>[t.seatsFilled,t.seatCount]),[[12,12],[12,12],[12,12]]);
 assert.equal(totalChips(r),3600000);assertRoom(r);
 const extra=who(36);register(r,extra,now);
 assert.throws(()=>applyPokerTableAction(r,'03',extra,{type:'join',seat:12,buyIn:20000},1,null,now));
 assert.equal(r.members[36].wallet,100000);
 const base={requestId:'b66d4984-f360-4673-8ef9-cd448a9cad93',handNumber:0,turnDeadline:null,requestAt:now,type:'join',buyIn:20000};
 for(let seat=0;seat<12;seat++)assert.equal(actionSchema.safeParse({...base,seat}).success,true);
 for(const seat of [-1,12,1.5])assert.equal(actionSchema.safeParse({...base,seat}).success,false);
});
test('new physical seat IDs retain the relative existing clockwise order',()=>{
 assert.deepEqual(POKER_SEAT_ORDER.filter(i=>i<8),[0,6,1,2,3,7,4,5]);
 assert.equal(new Set(POKER_SEAT_ORDER).size,12);assert.deepEqual([...POKER_SEAT_ORDER].sort((a,b)=>a-b),Array.from({length:12},(_,i)=>i));
});
