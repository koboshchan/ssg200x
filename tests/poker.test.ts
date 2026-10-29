import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register,applyAction,act,tick,startHand,showdown,totalChips,assertRoom,legal,TURN_MS,READY_MS,pot,shuffled} from "../lib/poker";
import {publicRoom} from "../lib/public";
import {actionSchema} from "../lib/schemas";
import type {Room,Identity,Seat} from "../lib/types";
const user=(n:number,admin=true):Identity=>({id:"user_"+n,name:"Player "+n,email:"p"+n+"@example.test",admin});
function setup(n=2){const r=freshRoom();for(let i=0;i<n;i++)register(r,user(i),1000);for(let i=0;i<n;i++)applyAction(r,user(i),{type:"join",seat:i,buyIn:20_000},1000);readyAll(r,1000);return r;}
function readyAll(r:Room,now:number){for(let i=0;i<r.seats.length;i++)if(r.seats[i])applyAction(r,user(i),{type:"ready"},now);}
function callThrough(r:Room){let count=0;while(!["waiting","showdown"].includes(r.street)&&count++<100){const s=r.seats[r.turn!]!;act(r,s.userId,{type:legal(r,r.turn!)!.check?"check":"call"},2000+count);}assert.ok(count<100);}
test("new non-admin accounts start once with $1,000 and can play immediately",()=>{const r=freshRoom();const m=register(r,user(0,false));assert.equal(m.wallet,100_000);assert.equal(m.approved,true);register(r,user(0,false));assert.equal(r.members.length,1);applyAction(r,user(0,false),{type:"join",seat:0,buyIn:10_000},1000);assert.equal(r.seats[0]?.userId,user(0,false).id);assertRoom(r);});
test("all seats explicitly ready starts hand, heads-up button posts SB and acts first",()=>{const r=setup();assert.equal(r.street,"preflop");assert.equal(r.turn,r.button);assert.equal(pot(r),300);assert.equal(r.currentBet,200);assertRoom(r);});
test("three players use live UTG $5 straddle",()=>{const r=setup(3);assert.equal(r.currentBet,500);assert.equal(pot(r),800);assert.equal(r.seats.filter(s=>s?.inHand).length,3);assertRoom(r);});
test("invalid turn, check facing bet, underraise and overdraw rejected",()=>{const r=setup();const i=r.turn!,id=r.seats[i]!.userId;assert.throws(()=>act(r,r.seats[1-i]!.userId,{type:"call"},1001));assert.throws(()=>act(r,id,{type:"check"},1001));assert.throws(()=>act(r,id,{type:"raise",to:250},1001));assert.throws(()=>act(r,id,{type:"raise",to:999999},1001));assertRoom(r);});
test("heads-up big blind retains option, postflop first action is non-button",()=>{const r=setup();act(r,r.seats[r.turn!]!.userId,{type:"call"},1100);assert.equal(r.turn,1-r.button);assert.equal(r.street,"preflop");act(r,r.seats[r.turn!]!.userId,{type:"check"},1200);assert.equal(r.street,"flop");assert.equal(r.board.length,3);assert.equal(r.turn,1-r.button);assertRoom(r);});
test("full raise resets pending action; raises are to total not increments",()=>{const r=setup();const i=r.turn!;act(r,r.seats[i]!.userId,{type:"raise",to:1000},1100);assert.equal(r.currentBet,1000);assert.equal(r.minRaise,800);assert.equal(r.seats[i]!.bet,1000);assert.equal(legal(r,r.turn!)!.minTo,1800);assertRoom(r);});
test("check through all streets reaches showdown and conserves every cent",()=>{const r=setup();callThrough(r);assert.equal(r.street,"showdown");assert.equal(r.board.length,5);assert.equal(pot(r),0);assert.equal(totalChips(r),200_000);assertRoom(r);});
test("fold immediately awards whole pot and never shows opponent holes",()=>{const r=setup();const i=r.turn!;act(r,r.seats[i]!.userId,{type:"fold"},1100);assert.equal(r.street,"showdown");assert.equal(r.payouts[0].amount,300);const view=publicRoom(r,user(i));assert.deepEqual(view.seats[1-i]!.hole,["?","?"]);assertRoom(r);});
test("active snapshots hide deck, email, user IDs and opponent holes",()=>{const r=setup();const view=publicRoom(r,{...user(0),admin:false});const text=JSON.stringify(view);assert.ok(!text.includes("deck"));assert.ok(!text.includes("user_"));assert.ok(!text.includes("@example.test"));assert.deepEqual(view.seats[1]!.hole,["?","?"]);assert.equal(view.seats[0]!.hole.length,2);});
test("timeout auto-folds without unseating or forfeiting remaining stack even when checking is free",()=>{for(const free of [false,true]){const r=setup();if(free)act(r,r.seats[r.turn!]!.userId,{type:"call"},2000);const i=r.turn!,wallet=r.members[i].wallet,stack=r.seats[i]!.stack,beforePot=pot(r);tick(r,r.deadline!);assert.ok(r.seats[i]);assert.equal(r.seats[i]!.folded,true);assert.equal(r.seats[i]!.stack,stack);assert.equal(r.payouts[0].amount,beforePot);assert.equal(r.street,"showdown");assert.equal(r.members[i].wallet,wallet);assertRoom(r);}});
test("leave during hand is rejected without scheduling cashout",()=>{const r=setup();const i=r.turn!,id=r.seats[i]!.userId;assert.throws(()=>applyAction(r,user(i),{type:"leave"},1100));assert.equal(r.seats[i]!.leaveAfter,false);act(r,id,{type:"fold"},1200);applyAction(r,user(i),{type:"leave"},1300);assert.equal(r.seats[i],null);assertRoom(r);});

test("seat restrictions and insufficient funds are enforced",()=>{const r=setup();assert.throws(()=>applyAction(r,user(0),{type:"join",seat:3,buyIn:10_000},1200));register(r,user(3));assert.throws(()=>applyAction(r,user(3),{type:"join",seat:0,buyIn:10_000},1200));assert.throws(()=>applyAction(r,user(3),{type:"join",seat:2,buyIn:100_001},1200));assert.throws(()=>applyAction(r,user(3),{type:"join",seat:-1,buyIn:10_000},1200));});
test("next hand waits eight seconds then needs fresh readiness and rotates button",()=>{const r=setup();const button=r.button;callThrough(r);tick(r,2500);assert.equal(r.street,"showdown");tick(r,20_000);assert.equal(r.street,"waiting");readyAll(r,20_000);assert.equal(r.street,"preflop");assert.notEqual(r.button,button);assert.equal(r.handNumber,2);assertRoom(r);});
function crafted(contributions:number[],holes:string[][],folded:number[]=[]):Room{
 const r=freshRoom();r.street="river";r.board=["2c","3d","7h","9s","Jc"];r.button=0;
 contributions.forEach((amount,i)=>{register(r,user(i),1000);r.members[i].wallet=100_000-amount;r.seats[i]={userId:user(i).id,stack:0,hole:holes[i],bet:amount,committed:amount,folded:folded.includes(i),inHand:true,actedAt:0,sitOut:false,leaveAfter:false,seen:1000};});
 return r;
}
test("side pots pay main and side winners, excess uncalled chips returned",()=>{
 const r=crafted([1000,2000,3000],[["As","Ad"],["Ks","Kd"],["Qs","Qd"]]);showdown(r,1000);
 assert.equal(r.seats[0]!.stack,3000);assert.equal(r.seats[1]!.stack,2000);assert.equal(r.seats[2]!.stack,1000);assertRoom(r);
});
test("folded contributions fund pots but cannot win",()=>{const r=crafted([1000,1000,1000],[["As","Ad"],["Ks","Kd"],["Qs","Qd"]],[0]);showdown(r,1000);assert.equal(r.seats[1]!.stack,3000);assert.equal(r.seats[0]!.stack,0);assertRoom(r);});
test("split pots distribute odd cents clockwise after dealer",()=>{const r=crafted([101,101,101],[["As","Kd"],["Ah","Ks"],["2s","2d"]],[2]);r.board=["Qc","Jd","Th","8s","7c"];showdown(r,1000);assert.equal(r.seats[1]!.stack,152);assert.equal(r.seats[0]!.stack,151);assertRoom(r);});
test("short all-in does not reopen betting for previous caller",()=>{
 const r=crafted([0,0,0],[["As","Ad"],["Ks","Kd"],["Qs","Qd"]]);
 r.board=[];r.street="preflop";r.currentBet=1000;r.minRaise=800;r.pending=[1,2];r.turn=1;r.deadline=2000;
 r.seats.forEach((s,i)=>{if(!s)return;s!.stack=i===1?1500:10_000;s!.committed=i===1?0:1000;s!.bet=s!.committed;s!.actedAt=i===1?null:1000;r.members[i].wallet=100_000-s!.stack-s!.committed;});
 act(r,user(1).id,{type:"raise",to:1500},1100);
 assert.equal(r.minRaise,800);assert.equal(legal(r,2)!.raiseOpen,false);assert.throws(()=>act(r,user(2).id,{type:"raise",to:2500},1200));
 act(r,user(2).id,{type:"call"},1200);assert.equal(r.turn,0);assert.equal(legal(r,0)!.raiseOpen,false);assertRoom(r);
});
test("all-in automatically runs board and conserves stacks",()=>{const r=setup();act(r,r.seats[r.turn!]!.userId,{type:"raise",to:20_000},1100);act(r,r.seats[r.turn!]!.userId,{type:"call"},1200);assert.equal(r.street,"showdown");assert.equal(r.board.length,5);assertRoom(r);});
test("shuffle uses one copy of each card",()=>{for(let i=0;i<30;i++){const d=shuffled();assert.equal(d.length,52);assert.equal(new Set(d).size,52);}});
test("strict action schema rejects client identities, floats, negative bets and forged decks",()=>{
 const base={requestId:"b66d4984-f360-4673-8ef9-cd448a9cad93",handNumber:1,turnDeadline:1000,requestAt:1000};
 assert.ok(actionSchema.safeParse({...base,type:"call"}).success);
 for(const input of [{...base,type:"call",userId:"victim"},{...base,type:"raise",to:1.3},{...base,type:"join",seat:0,buyIn:-100},{...base,type:"fold",deck:["As"]}])assert.equal(actionSchema.safeParse(input).success,false);
});
test("random legal play across 500 hands preserves invariant after every action",()=>{
 const r=setup(6);let steps=0;
 while(r.handNumber<500&&steps++<30_000) {
  if(r.street==="showdown"||r.street==="waiting"){
   for(const s of r.seats)if(s){s.seen=1000+steps*100;s.sitOut=false;}
   if(r.seats.filter(Boolean).length<2)break;
   const now=Math.max(r.nextDeal||0,1000+steps*100);tick(r,now);if(r.seats.filter(Boolean).length>=2)readyAll(r,now);assertRoom(r);continue;
  }
  const i=r.turn!,s=r.seats[i]!,l=legal(r,i)!;const choice=Math.random();
  if(choice<.13)act(r,s.userId,{type:"fold"},1000+steps*100);
  else if(choice>.80&&l.raiseOpen) {
   // Odd-cent split pots can leave a non-dollar all-in bound. Generate only
   // legal whole-dollar raises; do not change production fractional payouts.
   const to=Math.min(Math.floor(l.maxTo/100)*100,Math.ceil(l.minTo/100)*100+Math.floor(Math.random()*20)*100);
   if(to>=l.minTo&&to>r.currentBet)act(r,s.userId,{type:"raise",to},1000+steps*100);
   else act(r,s.userId,{type:l.check?"check":"call"},1000+steps*100);
  }else act(r,s.userId,{type:l.check?"check":"call"},1000+steps*100);
  assertRoom(r);
 }
 assert.ok(steps>0);
 assert.equal(totalChips(r),600_000);
});

test("joining never deals; all seated players must explicitly ready, with a two-minute waiting window",()=>{
 const r=freshRoom();for(let i=0;i<3;i++){register(r,user(i),1000);applyAction(r,user(i),{type:"join",seat:i,buyIn:20000},1000);}
 assert.equal(r.street,"waiting");assert.equal(r.handNumber,0);
 applyAction(r,user(0),{type:"ready"},2000);assert.equal(r.readyDeadline,2000+READY_MS);
 applyAction(r,user(0),{type:"ready"},3000);assert.equal(r.readyDeadline,2000+READY_MS);

 applyAction(r,user(1),{type:"ready"},3000);assert.equal(r.street,"waiting");
 tick(r,2000+READY_MS-1);assert.ok(r.seats[0]?.ready);assert.ok(r.seats[1]?.ready);
 tick(r,2000+READY_MS);assert.equal(r.readyDeadline,null);assert.ok(r.seats[0]);assert.ok(r.seats[1]);assert.equal(r.seats[0]?.ready,true);
 assert.equal(r.seats[2],null);assert.equal(r.members[2].wallet,100000);assert.equal(r.street,"preflop");assertRoom(r);
});
test("legacy waiting seats never autostart; legacy active leaveAfter cashes only after hand",()=>{
 const r=setup();r.seats[0]!.leaveAfter=true;delete r.seats[0]!.ready;
 assert.throws(()=>applyAction(r,user(0),{type:"leave"},1100));callThrough(r);tick(r,3000);assert.equal(r.seats[0],null);assertRoom(r);
 const q=freshRoom();for(let i=0;i<2;i++){register(q,user(i),1000);applyAction(q,user(i),{type:"join",seat:i,buyIn:20000},1000);delete q.seats[i]!.ready;}
 delete q.readyDeadline;tick(q,2000);assert.equal(q.handNumber,0);assert.equal(publicRoom(q,user(0)).seats[0]!.ready,false);
});
test("ready player with missing legacy deadline gets bounded timer rather than idle cashout",()=>{
 const r=freshRoom();register(r,user(0),1000);applyAction(r,user(0),{type:"join",seat:0,buyIn:20000},1000);
 r.seats[0]!.ready=true;delete r.readyDeadline;tick(r,1000000);
 assert.equal(r.readyDeadline,1000000+READY_MS);assert.ok(r.seats[0]);
 tick(r,1000000+READY_MS);assert.equal(r.seats[0]!.ready,false);assert.equal(r.readyDeadline,null);assert.equal(r.street,"waiting");assertRoom(r);
});
test("leaving unready last blocker starts the remaining ready seats atomically",()=>{
 const r=freshRoom();for(let i=0;i<3;i++){register(r,user(i),1000);applyAction(r,user(i),{type:"join",seat:i,buyIn:20000},1000);}
 applyAction(r,user(0),{type:"ready"},1100);applyAction(r,user(1),{type:"ready"},1100);
 applyAction(r,user(2),{type:"leave"},1200);
 assert.equal(r.street,"preflop");assert.equal(r.handNumber,1);assert.equal(r.members[2].wallet,100000);assert.equal(r.readyDeadline,null);assertRoom(r);
});
test("folded players cannot leave before hand settlement; readiness clears on settlement",()=>{
 const r=setup(3),i=r.turn!;
 act(r,user(i).id,{type:"fold"},1100);assert.throws(()=>applyAction(r,user(i),{type:"leave"},1200));
 callThrough(r);assert.ok(r.seats.filter(Boolean).every(s=>s!.ready===false));assert.equal(r.readyDeadline,null);
 applyAction(r,user(i),{type:"leave"},3000);assert.equal(r.seats[i],null);assertRoom(r);
});

test("ready at expiry cannot rescue an unready seat, and joining never extends timer",()=>{
 const r=freshRoom();for(let i=0;i<3;i++)register(r,user(i),1000);
 for(let i=0;i<2;i++)applyAction(r,user(i),{type:"join",seat:i,buyIn:20000},1000);
 applyAction(r,user(0),{type:"ready"},2000);const expiry=r.readyDeadline!;
 register(r,user(0),3000);applyAction(r,user(2),{type:"join",seat:2,buyIn:20000},3000);
 assert.equal(r.readyDeadline,expiry);for(const s of r.seats)if(s)s.seen=expiry;
 assert.throws(()=>applyAction(r,user(1),{type:"ready"},expiry),/Choose a seat/);
 assert.equal(r.seats[0]!.ready,false);assert.equal(r.seats[1],null);assert.equal(r.seats[2],null);
 assert.equal(r.members[1].wallet,100000);assert.equal(r.members[2].wallet,100000);
 assert.equal(r.readyDeadline,null);assert.equal(r.handNumber,0);assertRoom(r);
});

test("showdown inHand is historical: cashout is allowed after settlement without waiting for reveal",()=>{
 const r=setup();callThrough(r);
 assert.equal(r.street,"showdown");assert.equal(r.seats[0]!.inHand,true);
 assert.equal(r.seats[0]!.ready,false);
 const wallet=r.members[0].wallet,stack=r.seats[0]!.stack;
 applyAction(r,user(0),{type:"leave"},3000);
 assert.equal(r.seats[0],null);assert.equal(r.members[0].wallet,wallet+stack);
 assert.equal(r.street,"showdown");assertRoom(r);
});

test("readiness window protects idle unready blockers for the full two minutes",()=>{
 const r=freshRoom();for(let i=0;i<3;i++){register(r,user(i),1000);applyAction(r,user(i),{type:"join",seat:i,buyIn:20000},1000);}
 applyAction(r,user(0),{type:"ready"},2000);applyAction(r,user(1),{type:"ready"},3000);
 const expiry=r.readyDeadline!;assert.equal(READY_MS,120000);assert.equal(expiry,122000);
 tick(r,93001);
 assert.equal(r.seats.filter(Boolean).length,3);assert.equal(r.street,"waiting");assert.equal(r.handNumber,0);assert.equal(r.readyDeadline,expiry);
 tick(r,expiry-1);
 assert.equal(r.seats.filter(Boolean).length,3);assert.equal(r.handNumber,0);
 assert.equal(r.seats[2]!.ready,false);assert.equal(r.readyDeadline,expiry);
 tick(r,expiry);
 assert.equal(r.seats.filter(Boolean).length,2);assert.ok(r.seats.slice(0,2).every(s=>s?.ready));
 assert.equal(r.seats[2],null);assert.equal(r.members[2].wallet,100000);
 assert.equal(r.readyDeadline,null);assert.equal(r.handNumber,1);assert.equal(r.street,"preflop");
 tick(r,expiry+1);assert.equal(r.seats.filter(Boolean).length,2);assertRoom(r);
});
test("readiness window still cleans revoked seats rather than locking them until expiry",()=>{
 const r=freshRoom();for(let i=0;i<3;i++){register(r,user(i),1000);applyAction(r,user(i),{type:"join",seat:i,buyIn:20000},1000);}
 applyAction(r,user(0),{type:"ready"},2000);r.seats[2]!.leaveAfter=true;
 const expiry=r.readyDeadline;tick(r,3000);
 assert.equal(r.seats[2],null);assert.equal(r.readyDeadline,expiry);assert.equal(r.members[2].wallet,100000);assertRoom(r);
});

test("legacy false access flag does not block poker and registering migrates it",()=>{const r=freshRoom(),who=user(0,false),m=register(r,who,1000);m.approved=false;applyAction(r,who,{type:"join",seat:0,buyIn:10000},1000);assert.equal(r.seats[0]?.userId,who.id);register(r,who,1000);assert.equal(m.approved,true);assert.equal(m.wallet,90000);assertRoom(r);});

test("last unready player cashing out starts the remaining two ready players",()=>{
 const r=freshRoom();for(let i=0;i<3;i++){register(r,user(i),1000);applyAction(r,user(i),{type:"join",seat:i,buyIn:20000},1000);}
 applyAction(r,user(0),{type:"ready"},2000);applyAction(r,user(1),{type:"ready"},3000);
 assert.equal(r.street,"waiting");assert.equal(r.handNumber,0);
 applyAction(r,user(2),{type:"leave"},4000);
 assert.equal(r.seats[2],null);assert.equal(r.members[2].wallet,100000);
 assert.equal(r.seats.filter(Boolean).length,2);assert.equal(r.street,"preflop");assert.equal(r.handNumber,1);assert.equal(r.readyDeadline,null);
 assert.ok(r.seats.slice(0,2).every(s=>s?.inHand));assertRoom(r);
});


test("persisted all-unready window cashes everyone out once without creating pot money",()=>{
 const r=freshRoom();
 for(let i=0;i<3;i++){register(r,user(i),1000);applyAction(r,user(i),{type:"join",seat:i,buyIn:5000*(i+1)},1000);}
 r.readyDeadline=2000+READY_MS;
 const restarted=JSON.parse(JSON.stringify(r)) as Room;
 tick(restarted,restarted.readyDeadline!-1);assert.equal(restarted.seats.filter(Boolean).length,3);
 tick(restarted,restarted.readyDeadline!);
 assert.ok(restarted.seats.every(s=>s===null));assert.ok(restarted.members.every(m=>m.wallet===100000));
 assert.equal(restarted.readyDeadline,null);assert.equal(pot(restarted),0);assert.equal(restarted.pokerCarry??0,0);
 const once=JSON.stringify(restarted);assert.equal(tick(restarted,1000000),false);assert.equal(JSON.stringify(restarted),once);assertRoom(restarted);
});
test("ready expiry leaves lone ready player seated and never cashes players out during a hand",()=>{
 const r=freshRoom();
 for(let i=0;i<2;i++){register(r,user(i),1000);applyAction(r,user(i),{type:"join",seat:i,buyIn:20000},1000);}
 applyAction(r,user(0),{type:"ready"},2000);const expiry=r.readyDeadline!;
 tick(r,expiry);assert.equal(r.seats[0]!.ready,false);assert.equal(r.seats[1],null);assert.equal(r.members[0].wallet,80000);
 applyAction(r,user(0),{type:"ready"},expiry+1);

 applyAction(r,user(1),{type:"join",seat:1,buyIn:20000},expiry+1);
 applyAction(r,user(1),{type:"ready"},expiry+2);
 // A stale persisted waiting deadline must never refund participants in an active hand.
 r.readyDeadline=expiry;const wallets=r.members.map(m=>m.wallet);
 tick(r,expiry+3);assert.equal(r.street,"preflop");assert.ok(r.seats[0]);assert.ok(r.seats[1]);
 assert.deepEqual(r.members.map(m=>m.wallet),wallets);assertRoom(r);
});

test("unready withdraws consent before dealing without extending the waiting window",()=>{
 const r=freshRoom();for(let i=0;i<2;i++){register(r,user(i),1000);applyAction(r,user(i),{type:"join",seat:i,buyIn:20000},1000);}
 applyAction(r,user(0),{type:"ready"},2000);const expiry=r.readyDeadline;
 applyAction(r,user(0),{type:"unready"},3000);assert.equal(r.seats[0]!.ready,false);assert.equal(r.readyDeadline,expiry);
 applyAction(r,user(1),{type:"ready"},4000);assert.equal(r.handNumber,0);
 applyAction(r,user(0),{type:"ready"},5000);assert.equal(r.handNumber,1);
 const before=structuredClone(r);assert.throws(()=>applyAction(r,user(0),{type:"unready"},6000),/hand has started/);
 assert.deepEqual(r,before);assertRoom(r);
});
test("ready cashout credits exactly once and cannot cash out an active or folded participant",()=>{
 const r=freshRoom();register(r,user(0),1000);applyAction(r,user(0),{type:"join",seat:0,buyIn:20000},1000);
 applyAction(r,user(0),{type:"ready"},2000);applyAction(r,user(0),{type:"leave"},3000);
 assert.equal(r.members[0].wallet,100000);assert.equal(r.seats[0],null);assert.equal(r.readyDeadline,null);
 assert.throws(()=>applyAction(r,user(0),{type:"leave"},4000));assertRoom(r);
});
test("unready last ready player keeps original two-minute normal-refund window",()=>{
 const r=freshRoom();register(r,user(0),1000);applyAction(r,user(0),{type:"join",seat:0,buyIn:20000},1000);
 applyAction(r,user(0),{type:"ready"},2000);const expiry=r.readyDeadline!;
 applyAction(r,user(0),{type:"unready"},3000);tick(r,expiry);
 assert.equal(r.seats[0],null);assert.equal(r.members[0].wallet,100000);assert.equal(pot(r),0);assertRoom(r);
});
test("completed hand clears consent and idle ticks never automatically deal the next hand",()=>{
 const r=setup();act(r,r.seats[r.turn!]!.userId,{type:"fold"},2000);
 assert.equal(r.street,"showdown");assert.ok(r.seats.filter(Boolean).every(s=>!s!.ready));
 tick(r,20000);tick(r,40000);assert.equal(r.handNumber,1);assert.equal(r.street,"waiting");
 applyAction(r,user(0),{type:"ready"},41000);assert.equal(r.handNumber,1);
 applyAction(r,user(1),{type:"ready"},42000);assert.equal(r.handNumber,2);assertRoom(r);
});

test("ready window refunds never-ready seats and deals only 2+ ready players; lone ready loses no chips",()=>{
 const r=freshRoom();for(let i=0;i<3;i++){register(r,user(i),1000);applyAction(r,user(i),{type:"join",seat:i,buyIn:20000},1000);}
 applyAction(r,user(0),{type:"ready"},2000);const expiry=r.readyDeadline!;
 tick(r,expiry);assert.equal(r.handNumber,0);assert.equal(r.street,"waiting");
 assert.equal(r.seats[0]!.ready,false);assert.equal(r.seats[0]!.stack,20000);assert.equal(r.members[0].wallet,80000);
 assert.equal(r.seats[1],null);assert.equal(r.seats[2],null);
 assert.equal(r.members[1].wallet,100000);assert.equal(r.members[2].wallet,100000);
 for(let n=1;n<=4;n++)tick(r,expiry+n*READY_MS);
 assert.equal(r.handNumber,0);assert.equal(r.seats[0]!.stack,20000);assert.equal(pot(r),0);assertRoom(r);
 applyAction(r,user(0),{type:"leave"},expiry+5*READY_MS);
 assert.equal(r.members[0].wallet,100000);assertRoom(r);
});


test("unready before dealing permits immediate full cashout without starting a hand",()=>{
 const r=freshRoom();for(let i=0;i<3;i++){register(r,user(i),1000);applyAction(r,user(i),{type:"join",seat:i,buyIn:20000},1000);}
 applyAction(r,user(0),{type:"ready"},2000);
 applyAction(r,user(1),{type:"ready"},2100);
 const deadline=r.readyDeadline;
 applyAction(r,user(0),{type:"unready"},2200);
 assert.equal(r.seats[0]!.ready,false);assert.equal(r.readyDeadline,deadline);
 assert.equal(r.street,"waiting");assert.equal(r.handNumber,0);
 applyAction(r,user(0),{type:"leave"},2300);
 assert.equal(r.seats[0],null);assert.equal(r.members[0].wallet,100000);
 assert.equal(r.street,"waiting");assert.equal(r.handNumber,0);assertRoom(r);
});
