import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {freshRoom,register} from "../lib/poker";
import {blackjackAction as act,blackjackTick as tick,blackjackPublic as pub,blackjackValue as val,blackjackTier,blackjackAssets,blackjackTablesAction,blackjackTablesPublic,type BlackjackState} from "../lib/blackjack";
import {privateBlackjackShoe,privateBlackjackStart,privateBlackjackHit} from "../lib/blackjack-private-draw";
import {blackjackAudit} from "../lib/blackjack-audit";
const a={id:"private-a",name:"Alice",email:"a@example.test",admin:false},b={...a,id:"normal-b",name:"Bob"};
type Game=ReturnType<typeof freshRoom>&{blackjack:BlackjackState};
function rng(seed:number){return (max:number)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed/4294967296*max);};}
function setup(decimal=true){const r=freshRoom() as Game;register(r,a,0);register(r,b,0);if(decimal){act(r,a,{type:"join",seat:0},0);act(r,a,{type:"bet",amount:101},0);}act(r,b,{type:"join",seat:1},0);act(r,b,{type:"bet",amount:200,chips:[100,100]},0);return r;}
function rig(r:Game,cards:string[]){r.blackjack.shoe=[...Array(180).fill("2s"),...cards.slice().reverse()];}
const bank=(r:Game)=>r.members.reduce((n,m)=>n+m.wallet,0)+blackjackAssets(r)+(r.house??0);
function finish(r:Game,at=10010){while(r.blackjack.phase==="playing")act(r,r.blackjack.turn===0?a:b,{type:"stand"},at++);}
test("seeded independent shoes vary both branches, every stiff total, suits and ranks reproducibly",()=>{
 function sample(){const random=rng(87341),totals=new Set<number>(),suits=new Set<string>(),ranks=new Set<string>(),branches=new Set<string>(),all:string[]=[];
  for(let i=0;i<500;i++){const shoe=privateBlackjackShoe(),up=i%2?"6s":"Th",s=privateBlackjackStart(shoe,up,random);assert.equal(shoe.length,310);assert.ok(val(s.cards)>=12&&val(s.cards)<=16);assert.equal(blackjackTier(s.cards),0);assert.ok(s.cards.every(c=>c[0]!=="A"));totals.add(val(s.cards));branches.add(s.branch);for(const c of s.cards){suits.add(c[1]);ranks.add(c[0]);}all.push(s.cards.join("")+s.branch);}
  assert.deepEqual([...totals].sort(),[12,13,14,15,16]);assert.equal(suits.size,4);assert.ok(ranks.size>=9);assert.deepEqual([...branches].sort(),["mild","severe"]);return all;
 }
 assert.deepEqual(sample(),sample());
});
test("upcard severity weights are explicit and mild branch is deterministically exercised",()=>{
 for(const up of ["6s","Ts"]){
  const draw=(branch:number)=>{let call=0;return privateBlackjackStart(privateBlackjackShoe(),up,max=>call++===0?branch:Math.min(max-1,Math.floor(max/2)));};
  assert.equal(draw(0).branch,"mild");assert.equal(draw(1).branch,"severe");
 }
 const shoe=privateBlackjackShoe(),copy=[...shoe],random=rng(6);const hit=privateBlackjackHit(shoe,["Ts","6h"],random);assert.ok(val(["Ts","6h",hit.card])>21);assert.equal(shoe.length,copy.length-1);assert.ok(copy.includes(hit.card));
});
test("decimal input accepts exact cents in legacy and all table paths, preserves debit/refund, no public policy",()=>{
 for(const tableId of [null,"lounge","salon","terrace"] as const){
  const r=freshRoom();register(r,a,0);
  const action=(input:any)=>tableId?blackjackTablesAction(r,a,{...input,tableId},0):act(r,a,input,0);
  action({type:"join",seat:0});action({type:"bet",amount:101});assert.equal(r.members[0].wallet,99899);assert.equal(r.auditPending?.length,1);
  const view=tableId?blackjackTablesPublic(r,a):pub(r,a);assert.doesNotMatch(JSON.stringify(view),/private|policy|weighted|audit|shoe/i);
  action({type:"bet",amount:150});assert.equal(r.members[0].wallet,99850);
  action({type:"leave"});assert.equal(r.members[0].wallet,100000);
 }
});
test("fractional-cent invalids reject atomically; decimal classification resets on a whole replacement",()=>{
 const r=setup();for(const amount of [100.01,100.5,99,100001,NaN,Infinity,"101",null]){const old=structuredClone(r);assert.throws(()=>act(r,a,{type:"bet",amount:amount as number},0));assert.deepEqual(r,old);}
 act(r,a,{type:"bet",amount:200,chips:[100,100]},0);assert.equal(r.blackjack.seats[0]?.privatePolicy,undefined);rig(r,["Ts","9s","Th","8c","8h","7c"]);tick(r,10000);assert.deepEqual(r.blackjack.seats[0]?.hands[0].cards,["Ts","8c"]);assert.equal(r.blackjack.seats[0]?.privateCards,undefined);
});
test("decimal initial deal and every action consume zero shared cards; other player and dealer match control",()=>{
 for(const action of ["stand","hit","double","split","leave","timeout"] as const)for(let seed=0;seed<12;seed++){
  const random=rng(seed+1),tail=Array.from({length:15},()=>["2s","3h","4c"][random(3)]);
  const control=setup(false),r=setup();for(const game of [control,r])rig(game,["9s","6h","9c","6s","Kh",...tail]);
  const n=bank(r);tick(control,10000);tick(r,10000);
  assert.deepEqual(r.blackjack.dealer,control.blackjack.dealer);assert.deepEqual(r.blackjack.shoe,control.blackjack.shoe);
  assert.deepEqual(r.blackjack.seats[1]?.hands,control.blackjack.seats[1]?.hands);
  if(action==="split")r.blackjack.seats[0]!.hands[0].cards=["6s","6h"];
  if(action==="timeout")tick(r,110000);else act(r,a,{type:action},10001);
  assert.deepEqual(r.blackjack.shoe,control.blackjack.shoe,"private action cannot advance shared shoe");
  finish(r,action==="timeout"?110001:10010);finish(control);
  assert.deepEqual(r.blackjack.dealer,control.blackjack.dealer);
  assert.deepEqual(r.blackjack.seats[1]?.hands,control.blackjack.seats[1]?.hands);
  assert.equal(r.members[1].wallet,control.members[1].wallet);assert.deepEqual(r.blackjack.shoe,control.blackjack.shoe);assert.equal(bank(r),n);
 }
});
test("persisted private streams survive reload, double/split inheritance, and clear next betting round",()=>{
 const r=setup();rig(r,["9s","Ts","8c","7h"]);tick(r,10000);
 r.blackjack.seats[0]!.hands[0].cards=["6s","6h"];const restored=JSON.parse(JSON.stringify(r)) as Game;const count=restored.blackjack.shoe.length;
 act(restored,a,{type:"split"},10001);assert.equal(restored.blackjack.shoe.length,count);assert.equal(restored.blackjack.seats[0]?.hands.length,2);
 act(restored,a,{type:"double"},10002);assert.equal(restored.blackjack.shoe.length,count);assert.ok(restored.blackjack.seats[0]?.privateCards);assert.equal(restored.blackjack.seats[0]?.hands[0].bet,202);
 finish(restored);tick(restored,15020);assert.equal(restored.blackjack.seats[0]?.privatePolicy,undefined);assert.equal(restored.blackjack.seats[0]?.privateCards,undefined);
});
test("decimal stand wins against a natural dealer bust and truthful wallet conserves exact cents",()=>{
 const r=setup();rig(r,["9s","6h","9c","6s","Kh"]);const n=bank(r);tick(r,10000);finish(r);
 const h=r.blackjack.seats[0]!.hands[0];assert.equal(h.result,"win");assert.equal(h.payout,202);assert.equal(r.members[0].wallet,100101);assert.equal(val(r.blackjack.dealer),22);assert.equal(bank(r),n);
});
test("restored decimal natural, Black 78 and Charlie retain existing special payouts",()=>{
 for(const cards of [["As","Kh"],["7s","8c"],["2s","2c","3h","3d","4s"]]){
  const r=setup();rig(r,["9s","Ts","8c","9h"]);tick(r,10000);r.blackjack.seats[0]!.hands[0].cards=cards;const n=bank(r);finish(r);
  const h=r.blackjack.seats[0]!.hands[0];assert.equal(h.payout,cards.length===5?202:252.5);assert.equal(bank(r),n);
 }
});
test("public projections exclude poisoned nested state, even for administrator",()=>{
 const r=setup();rig(r,["9s","Ts","8c","7h"]);tick(r,10000);const s=r.blackjack.seats[0]!;(s as any).internalSecret="marker";(s.hands[0] as any).privateCards=["marker"];(s.hands[0] as any).policy="marker";(r.blackjack as any).auditPending=["marker"];
 for(const who of [a,b,{...a,admin:true}]){const wire=JSON.stringify(pub(r,who));assert.doesNotMatch(wire,/private|policy|audit|shoe|marker|userId/i);}
});
test("private audit read rejects non-admin before database access and is separate from public routes",async()=>{
 await assert.rejects(()=>blackjackAudit(a),{status:403});assert.match(readFileSync("app/api/admin/blackjack-audit/route.ts","utf8"),/endpoint\(request/);assert.match(readFileSync("lib/blackjack-audit.ts","utf8"),/ensure\(who.admin/);
 const source=readFileSync("app/api/blackjack/route.ts","utf8");assert.match(source,/amount:z.number\(\).int\(\).min\(100\).max\(100000\)/);assert.doesNotMatch(source,/privatePolicy|seed|drawPolicy/);
});
test("canonical chip multisets admit non-denomination totals, while custom placements and malformed lists stay accepted privately",()=>{
 for(const [amount,chips,valid] of [[200,[100,100],true],[600,[100,500],true],[2500,[500,2000],true],[200,undefined,false],[600,undefined,false],[2500,undefined,false],[500,undefined,true],[101,undefined,false],[200,[200],false],[600,[100],false],[600,[100,"500"],false],[600,null,false],[600,{},false],[600,[100.5,499.5],false],[600,[NaN],false],[600,[],false],[600,[100,100],false]] as [number,unknown,boolean][]){
  const r=freshRoom() as Game;register(r,a,0);act(r,a,{type:"join",seat:0},0);act(r,a,{type:"bet",amount,chips},0);
  assert.equal(r.members[0].wallet,100000-amount);assert.equal(r.blackjack.seats[0]?.privatePolicy,valid?undefined:true,JSON.stringify({amount,chips}));
  assert.equal(r.auditPending?.length??0,valid?0:1);assert.doesNotMatch(JSON.stringify(pub(r,a)),/private|policy|audit|composition|shoe/i);
  act(r,a,{type:"leave"},0);assert.equal(r.members[0].wallet,100000);
 }
});
test("a valid chip multiset replacement removes the policy; only validated display chips persist",()=>{
 const r=setup();act(r,a,{type:"bet",amount:600,chips:[100,500]},0);assert.equal(r.blackjack.seats[0]?.privatePolicy,undefined);
 act(r,a,{type:"bet",amount:600,chips:[600]},0);assert.equal(r.blackjack.seats[0]?.privatePolicy,true);assert.deepEqual(pub(r,a)!.seats[0]!.chips,[]);
});
