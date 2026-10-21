import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {freshRoom,register,assertRoom,totalChips,startHand,act,legal} from '../lib/poker';
import {applyPokerTableAction,pokerTableRoom} from '../lib/poker-tables';
import {applyPokerKick,reconcilePokerKickVotes,pokerKickNeedsTick,pokerKickSchema,publicPokerKickVote,type PokerKickRequest} from '../lib/poker-kicks';
import type {Room} from '../lib/types';
const now=Date.now(),who=(i:number)=>({id:'kick-user-'+i,name:'Player '+i,email:'test@invalid',admin:false});
function setup(n=4,id:'01'|'02'|'03'='01'){
 const r=freshRoom();for(let i=0;i<6;i++)register(r,who(i),now);
 for(let i=0;i<n;i++)applyPokerTableAction(r,id,who(i),{type:'join',seat:i,buyIn:20000},0,null,now);
 return r;
}
const pid=(r:Room,i:number)=>r.members.find(m=>m.id===who(i).id)!.publicId;
function req(r:Room,target=3,id:'01'|'02'|'03'='01'):Extract<PokerKickRequest,{action:"start"}>{return {action:'start',tableId:id,requestId:randomUUID(),requestAt:now,targetPublicId:pid(r,target)};}
function cast(r:Room,i:number,yes=true,at=now+1,id:'01'|'02'|'03'='01'){applyPokerKick(r,who(i),{action:'vote',tableId:id,requestId:randomUUID(),requestAt:at,voteId:r.pokerKickVotes![id]!.id,yes},at);assertRoom(r);}
test('unanimous other seated voters only, initiator auto yes, atomic exact cashout and public-safe view',()=>{
 for(const id of ['01','02','03'] as const){
  const r=setup(4,id),before=totalChips(r);applyPokerKick(r,who(0),req(r,3,id),now);
  const v=r.pokerKickVotes![id]!;assert.deepEqual(v.yesUserIds,[who(0).id]);assert.equal(v.eligibleUserIds.length,3);
  assert.throws(()=>cast(r,3,true,now+1,id),/not eligible/);
  assert.throws(()=>cast(r,4,true,now+1,id),/Only seated/);
  cast(r,1,true,now+1,id);assert.equal(v.status,'active');
  cast(r,2,true,now+2,id);assert.equal(v.status,'passed');
  assert.equal(pokerTableRoom(r,id).seats[3],null);assert.equal(r.members[3].wallet,100000);assert.equal(totalChips(r),before);
  assert.ok(!JSON.stringify(publicPokerKickVote(r,id)).includes('kick-user-'));
  assert.ok(r.auditPending!.some(e=>e.what==='poker.kick'));assertRoom(r);
 }
});
test('no immediately fails; no target removal, no initiator second vote, one vote per table',()=>{
 const r=setup();applyPokerKick(r,who(0),req(r),now);
 assert.throws(()=>applyPokerKick(r,who(1),req(r,2),now),/already active/);
 assert.throws(()=>cast(r,0),/already voted/);
 cast(r,1,false);assert.equal(r.pokerKickVotes!['01']!.status,'failed');
 assert.throws(()=>cast(r,2),/ended/);assert.ok(r.seats[3]);assertRoom(r);
});
test('minimum two eligible voters and no self-kicks or spectator starts',()=>{
 const r=setup(2);assert.throws(()=>applyPokerKick(r,who(0),req(r,1),now),/two other/);
 assert.throws(()=>applyPokerKick(r,who(0),req(r,0),now),/yourself/);
 assert.throws(()=>applyPokerKick(r,who(4),req(r,1),now),/Only seated/);
 assert.throws(()=>applyPokerKick(r,who(0),{...req(r),action:'admin-kick'},now),/Administrator/);
});
test('persistent global sixty-second throttle across tables, replay identity and payload binding',()=>{
 const r=setup();const request=req(r);applyPokerKick(r,who(0),request,now);
 applyPokerKick(r,who(0),request,now+1);assert.equal(r.auditPending!.length,1);
 assert.throws(()=>applyPokerKick(r,who(1),request,now+1),/replay/);
 assert.throws(()=>applyPokerKick(r,who(0),{...request,targetPublicId:pid(r,2)},now+1),/replay/);
 cast(r,1,false);
 applyPokerTableAction(r,'01',who(0),{type:'leave'},0,null,now+2);
 for(const [seat,i] of [0,4,5].entries())applyPokerTableAction(r,'02',who(i),{type:'join',seat,buyIn:20000},0,null,now+3);
 assert.throws(()=>applyPokerKick(r,who(0),{...req(r,5,'02'),requestAt:now+59999},now+59999),/sixty/);
 applyPokerKick(r,who(0),{...req(r,5,'02'),requestAt:now+60000},now+60000);
 assertRoom(r);
});
test('expiry exact boundary, immutable quorum cancels on any membership change and hand start',()=>{
 const expired=setup();applyPokerKick(expired,who(0),req(expired),now);
 assert.equal(pokerKickNeedsTick(expired,now+29999),false);assert.equal(pokerKickNeedsTick(expired,now+30000),true);
 assert.throws(()=>cast(expired,1,true,now+30000),/ended/);assert.equal(expired.pokerKickVotes!['01']!.status,'expired');
 for(const change of ['voter leaves','target leaves','new joins','starts hand']){
  const r=setup();applyPokerKick(r,who(0),req(r),now);
  if(change==='new joins')applyPokerTableAction(r,'01',who(4),{type:'join',seat:4,buyIn:20000},0,null,now+1);
  else if(change==='starts hand'){for(const s of r.seats)if(s)s.ready=true;startHand(r,now+1);}
  else applyPokerTableAction(r,'01',who(change==='target leaves'?3:2),{type:'leave'},0,null,now+1);
  reconcilePokerKickVotes(r,now+1);assert.equal(r.pokerKickVotes!['01']!.status,'cancelled',change);assertRoom(r);
 }
});
test('admin active-hand cashout keeps other turn deadline and committed side-pot levels',()=>{
 const r=setup();for(const s of r.seats)if(s)s.ready=true;startHand(r,now);
 assert.throws(()=>applyPokerKick(r,who(0),req(r),now),/between hands/);
 const target=r.seats.findIndex((s,i)=>s&&i!==r.turn&&s.committed>0);
 const old=structuredClone(r.seats[target]!),deadline=r.deadline,turn=r.turn;
 applyPokerKick(r,{...who(5),admin:true},{...req(r,target),action:'admin-kick'},now+1);
 assert.equal(r.seats[target],null);assert.equal(r.members[target].wallet,80000+old.stack);
 assert.ok(r.pokerDead!.includes(old.committed));assert.equal(r.turn,turn);assert.equal(r.deadline,deadline);assertRoom(r);
 // Resolve normal engine action flow after detached committed contributions.
 let steps=0;while(r.street!=='showdown'&&steps++<100){
  const s=r.seats[r.turn!]!;act(r,s.userId,{type:s.bet<r.currentBet?'call':'check'},now+2+steps);assertRoom(r);
 }
 assert.equal(r.street,'showdown');assert.equal(totalChips(r),600000);
});
test('admin removing current turn advances safely and heads-up settles without forfeiting stack',()=>{
 for(const n of [2,3,4]){
  const r=setup(n);for(const s of r.seats)if(s)s.ready=true;startHand(r,now);
  const target=r.turn!,stack=r.seats[target]!.stack;
  applyPokerKick(r,{...who(5),admin:true},{...req(r,target),action:'admin-kick'},now+1);
  assert.equal(r.members[target].wallet,80000+stack);assert.equal(r.seats[target],null);
  if(n===2)assert.equal(r.street,'showdown');else{assert.notEqual(r.turn,target);assert.equal(r.deadline,now+1+60000);}
  assertRoom(r);
 }
});
test('strict schema denies injected admin flags, malformed vote, expired request, preserves showdown payouts',()=>{
 const r=setup();assert.equal(pokerKickSchema.safeParse({...req(r),admin:true}).success,false);
 assert.equal(pokerKickSchema.safeParse({...req(r),requestId:'abc'}).success,false);
 assert.throws(()=>applyPokerKick(r,who(0),req(r),now+120001),/expired/);
 for(const s of r.seats)if(s)s.ready=true;startHand(r,now);
 while(r.street!=='showdown')act(r,r.seats[r.turn!]!.userId,{type:'fold'},now+1);
 const target=r.seats.findIndex(s=>s&&s.stack>20000),stack=r.seats[target]!.stack;
 applyPokerKick(r,{...who(5),admin:true},{...req(r,target),action:'admin-kick'},now+2);
 assert.equal(r.members[target].wallet,80000+stack);assertRoom(r);
});
test('unequal all-in side pots survive admin removal and every chip remains accounted',()=>{
 const r=setup(4);
 // Keep each member's $200 buy-in ledger balanced while varying effective stacks.
 for(const [i,stack] of [2000,5000,10000,20000].entries()){r.members[i].wallet+=r.seats[i]!.stack-stack;r.seats[i]!.stack=stack;r.seats[i]!.ready=true;}
 startHand(r,now);
 const target=r.turn!,s=r.seats[target]!;
 // Remove a deeper committed contributor while other players continue to all-in.
 const refund=s.stack,contribution=s.committed;
 applyPokerKick(r,{...who(5),admin:true},{...req(r,target),action:'admin-kick'},now+1);
 assert.equal(r.members[target].wallet,100000-([2000,5000,10000,20000][target])+refund);
 if(contribution)assert.ok(r.pokerDead!.includes(contribution));
 let actions=0;
 while(r.street!=='showdown'&&actions++<50){
  const actor=r.seats[r.turn!]!,to=actor.stack+actor.bet;
  const choices=legal(r,r.turn!)!;
  act(r,actor.userId,choices.raiseOpen?{type:'raise',to}:{type:choices.check?'check':'call'},now+2+actions);
  assertRoom(r);
 }
 assert.equal(r.street,'showdown');assert.equal(totalChips(r),600000);
});

test('nonadmin starts require waiting with an unready player, never showdown or all-ready state',()=>{
 for(const mode of ['showdown','all-ready'] as const){
  const r=setup();
  if(mode==='showdown')r.street='showdown';
  else for(const s of r.seats)if(s)s.ready=true;
  assert.throws(()=>applyPokerKick(r,who(0),req(r),now),/waiting for players/);
  assert.equal(r.pokerKickVotes,undefined);
 }
});
