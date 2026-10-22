import {test,after,before} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {miniAction,miniSnapshot} from '../../lib/minigames';
import {db,readRoom,closeDatabase} from '../../lib/db';
import {mutate} from '../../lib/store';
import {assertRoom,register} from '../../lib/poker';
import {casinoLimits} from '../../lib/casino-limits';
import {changeCasinoLimits} from '../../lib/admin-casino-limits';
if(!process.env.MONGODB_DB?.startsWith('fakebucks_test_'))throw Error('Requires isolated test DB');
process.env.MONGODB_DB+='_mini';
const who={id:'a',name:'A',email:'a@test',admin:false},other={...who,id:'b'},admin={...who,id:'admin',admin:true};
const meta=()=>({requestId:randomUUID(),requestAt:Date.now()});
before(async()=>{await(await db()).dropDatabase();});after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
test('parallel identical start debits once and persists across database restart',async()=>{const input={...meta(),type:'start' as const,game:'chicken' as const,amount:1000};await Promise.all(Array.from({length:8},()=>mutate(r=>miniAction(r,who,input,()=>1))));await closeDatabase();let r=await readRoom();assertRoom(r);assert.equal(r.members[0].wallet,99000);assert.equal(r.miniGames!.length,1);const g=r.miniGames![0];assert.equal(g.status,'active');assert.equal(g.steps,1);assert.equal(g.revision,0);await mutate(r=>miniAction(r,who,{...meta(),type:'step',id:g.id,revision:0},()=>1));await closeDatabase();r=await readRoom();assert.equal(r.miniGames![0].steps,2);assertRoom(r);});
test('parallel duplicate cashout credits and audits once; future reuse rejects',async()=>{let r=await readRoom();const g=r.miniGames![0],input={...meta(),type:'cashout' as const,id:g.id,revision:g.revision};await Promise.all(Array.from({length:8},()=>mutate(r=>miniAction(r,who,input))));await closeDatabase();r=await readRoom();assert.equal(r.members[0].wallet,100531);assert.equal(r.miniGames![0].payout,1531);assertRoom(r);assert.equal(await(await db()).collection('audit').countDocuments({what:'minigame-cashout'}),1);await assert.rejects(mutate(r=>miniAction(r,who,{...input,revision:input.revision+1})));});
test('competing step/cashout commits exactly one revision; insufficient wallet races fail closed',async()=>{await mutate(r=>miniAction(r,who,{...meta(),type:'start',game:'mines',amount:1000,mines:3},()=>0));let r=await readRoom();const g=r.miniGames![0];const cells=Array.from({length:25},(_,i)=>i).filter(i=>!g.bombs!.includes(i));await mutate(r=>miniAction(r,who,{...meta(),type:'step',id:g.id,revision:0,cell:cells[0]}));const outcomes=await Promise.allSettled([mutate(r=>miniAction(r,who,{...meta(),type:'step',id:g.id,revision:1,cell:cells[1]})),mutate(r=>miniAction(r,who,{...meta(),type:'cashout',id:g.id,revision:1}))]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);r=await readRoom();assertRoom(r);await mutate(r=>register(r,other));const starts=await Promise.allSettled(['chicken','hilo'].map(game=>mutate(r=>miniAction(r,other,{...meta(),type:'start',game:game as 'chicken'|'hilo',amount:100000},()=>1))));assert.equal(starts.filter(x=>x.status==='fulfilled').length,1);r=await readRoom();assert.equal(r.members.find(m=>m.id==='b')!.wallet,0);assertRoom(r);});
test('eight concurrent Plinko wagers each settle once with their exact stable result ID',async()=>{
 const player={...who,id:'plinko-eight'};
 await mutate(r=>register(r,player));
 const inputs=Array.from({length:8},()=>({...meta(),type:'start' as const,game:'plinko' as const,amount:1000}));
 const outcomes=await Promise.all(inputs.map(input=>mutate(r=>miniAction(r,player,input,()=>0))));
 for(let i=0;i<inputs.length;i++){
  assert.equal(outcomes[i].result,inputs[i].requestId);
  const g=outcomes[i].room.miniGames!.find(g=>g.id===outcomes[i].result)!;
  assert.equal(g.bet,1000);assert.equal(g.status,'won');assert.equal(g.owner,player.id);
 }
 await closeDatabase();let r=await readRoom();assertRoom(r);
 const games=r.miniGames!.filter(g=>g.owner===player.id);
 assert.equal(games.length,8);assert.equal(new Set(games.map(g=>g.id)).size,8);
 assert.equal(r.members.find(m=>m.id===player.id)!.wallet,100000-8000+games.reduce((n,g)=>n+g.payout,0));
 const before=r.members.find(m=>m.id===player.id)!.wallet;
 // Replay all envelopes after a database reconnect, in reverse response order.
 const replays=await Promise.all([...inputs].reverse().map(input=>mutate(r=>miniAction(r,player,input,()=>1))));
 assert.deepEqual(new Set(replays.map(x=>x.result)),new Set(inputs.map(x=>x.requestId)));
 r=await readRoom();assertRoom(r);assert.equal(r.members.find(m=>m.id===player.id)!.wallet,before);
 assert.equal(await(await db()).collection('audit').countDocuments({who:player.id,what:'minigame-start'}),8);
});
test('simultaneous duplicate Plinko envelopes neither reroll nor double-charge among distinct drops',async()=>{
 const player={...who,id:'plinko-duplicate'};await mutate(r=>register(r,player));
 const inputs=Array.from({length:4},()=>({...meta(),type:'start' as const,game:'plinko' as const,amount:500}));
 const values=await Promise.all(inputs.flatMap(input=>[mutate(r=>miniAction(r,player,input)),mutate(r=>miniAction(r,player,input))]));
 for(let i=0;i<inputs.length;i++){assert.equal(values[i*2].result,inputs[i].requestId);assert.equal(values[i*2+1].result,inputs[i].requestId);}
 const r=await readRoom(),games=r.miniGames!.filter(g=>g.owner===player.id);assertRoom(r);
 assert.equal(games.length,4);assert.equal(r.members.find(m=>m.id===player.id)!.wallet,100000-2000+games.reduce((n,g)=>n+g.payout,0));
 assert.equal(await(await db()).collection('audit').countDocuments({who:player.id,what:'minigame-start'}),4);
 await assert.rejects(mutate(r=>miniAction(r,player,{...inputs[0],amount:600})),/different order/);
});
test('concurrent full-wallet Plinko bets fail closed rather than overspending',async()=>{
 const player={...who,id:'plinko-funds'};await mutate(r=>register(r,player));
 const inputs=Array.from({length:8},()=>({...meta(),type:'start' as const,game:'plinko' as const,amount:100000}));
 const outcomes=await Promise.allSettled(inputs.map(input=>{let bit=0;return mutate(r=>miniAction(r,player,input,()=>bit++%2));}));
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 const r=await readRoom(),games=r.miniGames!.filter(g=>g.owner===player.id);assertRoom(r);assert.equal(games.length,1);
 assert.equal(r.members.find(m=>m.id===player.id)!.wallet,games[0].payout);
 assert.equal(await(await db()).collection('audit').countDocuments({who:player.id,what:'minigame-start'}),1);
});
test('admin limit authorization, old clients preserve games cap, existing games remain payable',async()=>{await mutate(r=>changeCasinoLimits(r,admin,{...casinoLimits(r),gamesMaxBet:100,expectedVersion:casinoLimits(r).revision}));await assert.rejects(mutate(r=>changeCasinoLimits(r,who,{rouletteMaxTotal:100,blackjackMaxHand:100,expectedVersion:casinoLimits(r).revision})));await mutate(r=>changeCasinoLimits(r,admin,{rouletteMaxTotal:1000,blackjackMaxHand:1000,expectedVersion:casinoLimits(r).revision}));let r=await readRoom();assert.equal(casinoLimits(r).gamesMaxBet,100);await assert.rejects(mutate(r=>miniAction(r,who,{...meta(),type:'start',game:'dice',amount:200,target:50,direction:'over'})));r=await readRoom();const g=r.miniGames!.find(g=>g.owner==='b'&&g.status==='active')!;await mutate(r=>miniAction(r,other,{...meta(),type:'step',id:g.id,revision:0,...(g.kind==='hilo'?{choice:'high' as const}:{})},()=>2));assertRoom(await readRoom());assert.ok(!JSON.stringify(miniSnapshot(await readRoom(),who)).includes('bombs'));});

test('lost Mines reveal survives restart while active boards remain private',async()=>{
 const player={...who,id:'mines-disclosure'};
 const input={...meta(),type:'start' as const,game:'mines' as const,amount:100,mines:10};
 await mutate(r=>miniAction(r,player,input,()=>0));await closeDatabase();
 let r=await readRoom();const g=r.miniGames!.find(x=>x.owner===player.id)!;
 assert.ok(!('bombs' in miniSnapshot(r,player).games[0]));
 const expected=[...g.bombs!];
 await mutate(r=>miniAction(r,player,{...meta(),type:'step',id:g.id,revision:0,cell:expected[0]}));
 await closeDatabase();r=await readRoom();const snapshot=miniSnapshot(r,player);
 assert.equal(snapshot.games[0].status,'lost');assert.deepEqual(snapshot.games[0].bombs,expected);
 assert.ok(!miniSnapshot(r,who).games.some(x=>x.id===g.id));assertRoom(r);
});

test('chicken first-lane loss commits atomically and duplicate/reconnect replay cannot reroll',async()=>{
 const player={...who,id:'chicken-first-loss'},input={...meta(),type:'start' as const,game:'chicken' as const,amount:100};
 await Promise.all(Array.from({length:8},()=>mutate(r=>miniAction(r,player,input,()=>0))));
 await closeDatabase();let r=await readRoom(),g=r.miniGames!.find(g=>g.id===input.requestId)!;
 assert.equal(g.status,'lost');assert.equal(g.steps,1);assert.equal(g.result?.hit,1);
 assert.equal(r.members.find(m=>m.id===player.id)!.wallet,99900);
 await mutate(r=>miniAction(r,player,input,()=>{throw Error('replay rerolled');}));
 r=await readRoom();assertRoom(r);assert.equal(r.miniGames!.filter(g=>g.id===input.requestId).length,1);
 assert.equal(await(await db()).collection('audit').countDocuments({who:player.id,what:'minigame-start'}),1);
});

test('chicken fifteenth-lane duplicate settles once and step/cashout race has one winner',async()=>{
 for(const race of [false,true]){
  const player={...who,id:'chicken-final-'+race},start={...meta(),type:'start' as const,game:'chicken' as const,amount:100};
  await mutate(r=>miniAction(r,player,start,()=>1));
  for(let lane=2;lane<=14;lane++)await mutate(r=>{const g=r.miniGames!.find(g=>g.id===start.requestId)!;return miniAction(r,player,{...meta(),type:'step',id:g.id,revision:g.revision},()=>1);});
  let r=await readRoom();const g=r.miniGames!.find(g=>g.id===start.requestId)!;
  assert.equal(g.steps,14);assert.equal(g.status,'active');
  const step={...meta(),type:'step' as const,id:g.id,revision:g.revision};
  const cash={...meta(),type:'cashout' as const,id:g.id,revision:g.revision};
  const outcomes=await Promise.allSettled(Array.from({length:8},(_,i)=>mutate(r=>miniAction(r,player,race&&i%2?cash:step,()=>1))));
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,race?4:8);
  await closeDatabase();r=await readRoom();const final=r.miniGames!.find(g=>g.id===start.requestId&&g.owner===player.id)!;
  assert.equal(final.status,race&&final.steps===14?'cashed':'won');assert.ok(final.steps===14||final.steps===15);
  assert.equal(r.members.find(m=>m.id===player.id)!.wallet,100000-100+final.payout);assertRoom(r);
  assert.equal(await(await db()).collection('audit').countDocuments({who:player.id,what:{$in:['minigame-step','minigame-cashout']}}),14);
 }
});

test('concurrent Plinko risk tables persist immutably across reconnect and replay',async()=>{
 const player={...who,id:'plinko-risk-persist'};
 const inputs=(['low','medium','high'] as const).map(risk=>({...meta(),type:'start' as const,game:'plinko' as const,amount:100,risk}));
 await Promise.all(inputs.map(input=>mutate(r=>miniAction(r,player,input,()=>0))));
 await closeDatabase();let r=await readRoom();
 const expected=structuredClone(r.miniGames!.filter(g=>g.owner===player.id));
 for(const input of inputs){
  const g=expected.find(g=>g.id===input.requestId)!;
  assert.equal(g.risk,input.risk);assert.equal(g.plinkoTable!.length,9);
  assert.equal(g.payout,Number(BigInt(g.bet)*BigInt(g.plinkoTable![0].numerator)/BigInt(g.plinkoTable![0].denominator)));
 }
 await assert.rejects(mutate(r=>miniAction(r,player,{...inputs[0],risk:'high'})),/different order/);
 await Promise.all([...inputs].reverse().map(input=>mutate(r=>miniAction(r,player,input,()=>{throw Error('replay RNG');}))));
 await closeDatabase();r=await readRoom();assertRoom(r);
 assert.deepEqual(r.miniGames!.filter(g=>g.owner===player.id),expected);
 const wallet=r.members.find(m=>m.id===player.id)!.wallet;
 assert.equal(wallet,100000-300+expected.reduce((n,g)=>n+g.payout,0));
});
