import {test} from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {readFileSync} from "node:fs";
import {ROULETTE_CHIPS} from "../lib/roulette-chips";
import {freshRoom,register,assertRoom,totalChips} from "../lib/poker";
import {rouletteState,rouletteAction,rouletteTick,roulettePublic} from "../lib/roulette";
import {publicRoom} from "../lib/public";
import {rouletteAudit} from "../lib/roulette-audit";
import {rouletteBetSchema} from "../lib/casino-schemas";
import type {Bet} from "../lib/market-shared";
const a={id:"a-private",name:"Alice",email:"private@example.test",admin:false};
const b={...a,id:"b-private",name:"Bob"};
const redWin=(max:number)=>max===37?1:0;
const fairRed=(amount:number)=>Math.ceil(amount*37/18);
function setup(){const r=freshRoom();register(r,a,1000);register(r,b,1000);rouletteState(r,1000);return r;}
function place(r:ReturnType<typeof setup>,amount:number,id="chip",who=a,extra:object={}){
 rouletteAction(r,who,{type:"bet",bet:{kind:"red",amount,...extra}},1,id,1000);
}
test("actual UI picker and server share unchanged chip denominations",()=>{
 assert.deepEqual(ROULETTE_CHIPS.map(x=>x.value),[1,5,20,50,100]);
 const ui=readFileSync("app/roulette-client.tsx","utf8");
 assert.match(ui,/ROULETTE_CHIPS as denominations/);assert.match(ui,/amount\}\}\)\}/);
});
test("all valid whole-dollar placements pay fairly without silent forfeiture",()=>{
 for(let amount=100;amount<=100000;amount+=100){
  const r=setup(),bank=totalChips(r);place(r,amount);
  assert.equal(r.members[0].wallet,100000-amount);assert.equal(rouletteState(r,1000).bets[0].dead,undefined);assert.equal(rouletteState(r,1000).bets[0].houseEdgeBps,0);
  assert.equal(r.auditPending?.length??0,0);assertRoom(r);
  rouletteTick(r,61000,redWin);
  const returned=fairRed(amount);
  assert.equal(r.members[0].wallet,100000-amount+returned);
  assert.equal(r.members[0].spins![0].returned,returned);
  assert.equal(r.house,amount-returned);assert.equal(totalChips(r),bank);assertRoom(r);
  const before=structuredClone(r);rouletteTick(r,61001,redWin);assert.deepEqual(r,before);
 }
});
test("normal and custom wagers share the same visible shape for owners, peers and room snapshots",()=>{
 const r=setup();place(r,300,"custom");place(r,500,"normal",b);
 for(const viewer of [a,b,{...b,admin:true}]){
  const dto=roulettePublic(r,viewer,1000)!;
  for(const w of dto.bets){assert.deepEqual(Object.keys(w).sort(),["bet","id","isYou","name","publicId"]);assert.deepEqual(Object.keys(w.bet).sort(),["amount","kind"]);}
  for(const text of [JSON.stringify(dto),JSON.stringify(publicRoom(r,viewer))]){
   assert.doesNotMatch(text,/"(?:dead|auditPending|placement)"|a-private|private@example/);
  }
 }
 assert.equal(r.auditPending?.length??0,0);
});
test("client flags cannot mark payable wagers dead or change server snapshots; DTO allowlists remove nested extras",()=>{
 const r=setup();place(r,300,"custom",a,{dead:false,live:true,chipAmounts:[100,100,100]});
 place(r,500,"normal",b,{dead:true,live:false,secretAudit:"spoof"});
 const w=rouletteState(r,1000).bets;
 assert.equal(w[0].dead,undefined);assert.equal(w[1].dead,undefined);
 assert.deepEqual(w[0].bet,{kind:"red",amount:300});assert.deepEqual(w[1].bet,{kind:"red",amount:500});
 assert.equal(rouletteBetSchema.safeParse({kind:"red",amount:300,dead:false}).success,false);
 rouletteTick(r,61000,redWin);
 assert.equal(r.members[0].wallet,99700+fairRed(300));assert.equal(r.members[1].wallet,99500+fairRed(500));
 assert.doesNotMatch(JSON.stringify(publicRoom(r,a)),/"(?:dead|auditPending|live|secretAudit)"|spoof/);
});
test("decimal rejection with no debit or audit, including change",()=>{
 const r=setup();place(r,500);
 for(const amount of [150,100.5,Infinity,NaN,"300",null]){
  for(const type of ["bet","change"] as const){
   const before=structuredClone(r);
   assert.throws(()=>rouletteAction(r,a,{type,betId:"chip",bet:{kind:"red",amount:amount as number}},1,"invalid",1000));
   assert.deepEqual(r,before);
  }
 }
});
test("legit repeated chip clicks preserve their denomination multiset, even when aggregate is custom",()=>{
 const r=setup();place(r,100,"one");place(r,100,"two");place(r,100,"three");place(r,500,"five");
 const bets=rouletteState(r,1000).bets.map(w=>w.bet);
 assert.equal(bets.filter(b=>b.amount===100).reduce((n,b)=>n+b.amount,0),300);
 rouletteTick(r,61000,redWin);rouletteTick(r,78000,redWin);
 const before=r.members[0].wallet;
 assert.deepEqual(roulettePublic(r,a,78000)!.lastBets,bets);
 rouletteAction(r,a,{type:"rebet"},2,"repeat",78000);
 const repeated=rouletteState(r,78000).bets;
 assert.deepEqual(repeated.map(w=>w.bet),bets);assert.equal(repeated.length,4);
 assert.ok(repeated.every(w=>!w.dead));assert.equal(r.auditPending?.length??0,0);
 assert.equal(r.members[0].wallet,before-800);assertRoom(r);
 rouletteTick(r,138000,redWin);assert.equal(r.members[0].spins![0].returned,3*fairRed(100)+fairRed(500));assertRoom(r);
});
test("Last bet excludes explicit historical dead wagers but repeats payable custom amounts",()=>{
 const r=setup();place(r,300,"custom");place(r,500,"normal");
 // Historical unpayable wager is explicitly persisted, never manufactured by new actions.
 const state=rouletteState(r,1000);state.bets[0].dead=true;delete state.bets[0].houseEdgeBps;
 rouletteTick(r,61000,redWin);rouletteTick(r,78000,redWin);
 state.previousBets!.push({id:"old",userId:a.id,bet:{kind:"red",amount:300}});
 state.previousBets!.push({id:"changed",userId:a.id,bet:{kind:"red",amount:100},dead:true});
 const expected=[{kind:"red",amount:500},{kind:"red",amount:300}];
 assert.deepEqual(roulettePublic(r,a,78000)!.lastBets,expected);
 const before=r.members[0].wallet;
 rouletteAction(r,a,{type:"rebet"},2,"again",78000);
 assert.equal(r.members[0].wallet,before-800);assert.deepEqual(state.bets.map(w=>w.bet),expected);
 assert.ok(state.bets.every(w=>w.houseEdgeBps===0&&!w.dead));
 rouletteTick(r,138000,redWin);assert.equal(r.members[0].spins![0].returned,fairRed(500)+fairRed(300));
});
test("new custom chip replacements remain payable, and clear refunds exact escrow",()=>{
 const r=setup();place(r,500,"one");
 rouletteAction(r,a,{type:"change",betId:"one",bet:{kind:"red",amount:300}},1,"edit",1000);
 assert.equal(r.members[0].wallet,99700);assert.equal(rouletteState(r,1000).bets[0].dead,undefined);
 rouletteAction(r,a,{type:"change",betId:"one",bet:{kind:"red",amount:100}},1,"launder",1000);
 assert.equal(r.members[0].wallet,99900);assert.equal(rouletteState(r,1000).bets[0].dead,undefined);
 const before=structuredClone(r);assert.throws(()=>rouletteAction(r,b,{type:"cancel",betId:"one"},1,"other",1000));assert.deepEqual(r,before);
 rouletteAction(r,a,{type:"cancel",betId:"one"},1,"clear",1000);
 assert.equal(r.members[0].wallet,100000);assert.equal(rouletteState(r,1000).bets.length,0);assert.equal(r.auditPending?.length??0,0);
 place(r,100,"fresh");assert.notEqual(rouletteState(r,1000).bets[0].dead,true);rouletteTick(r,61000,redWin);assert.equal(r.members[0].wallet,99900+fairRed(100));
});
test("all legitimate chip replacements remain live, cap and lock failures never create audit records",()=>{
 const r=setup();place(r,100,"chip");
 for(const chip of ROULETTE_CHIPS){
  rouletteAction(r,a,{type:"change",betId:"chip",bet:{kind:"red",amount:chip.value*100}},1,"change",1000);
  assert.notEqual(rouletteState(r,1000).bets[0].dead,true);
 }
 assert.equal(r.auditPending?.length??0,0);
 for(const amount of [100001,100100]){
  const before=structuredClone(r);assert.throws(()=>place(r,amount,"bad"));assert.deepEqual(r,before);
 }
 const before=structuredClone(r);
 assert.throws(()=>rouletteAction(r,a,{type:"bet",bet:{kind:"red",amount:300}},1,"locked",56000));assert.deepEqual(r,before);
 assert.throws(()=>rouletteAction(r,a,{type:"bet",bet:{kind:"red",amount:300}},2,"stale",1000));assert.deepEqual(r,before);
});
test("admin-only audit fails closed for ordinary users before touching the database",async()=>{
 await assert.rejects(()=>rouletteAudit(a),{status:403});
 const route=readFileSync("app/api/admin/roulette-audit/route.ts","utf8");assert.match(route,/endpoint\(request/);assert.match(route,/rouletteAudit\(who/);
});
test("mounted roulette client bundle contains chip display only, no private dead/audit enforcement",async()=>{
 const bundle=await build({entryPoints:["app/roulette-client.tsx"],bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",loader:{".module.css":"empty"},logLevel:"silent"});
 const text=bundle.outputFiles[0].text;
 assert.doesNotMatch(text,/roulette-dead-placement|auditPending|Administrator access|required\.\s*dead|function returnedFor|function repeatable|\.dead\b|dead:/);
});
test('nested persisted spin/history/winner extras cannot escape the explicit roulette projection',()=>{
 const r=setup();place(r,300);rouletteTick(r,61000,redWin);
 const state=rouletteState(r,0);Object.assign(state.spin!,{dead:true,auditPending:['private']});
 Object.assign(state.history[0],{dead:true,privateAudit:'secret'});
 state.history[0].winners=[Object.assign({publicId:'peer',name:'Bob',stake:100,returned:200},{dead:true,privateAudit:'secret'})];
 Object.assign(state.settledBets![0].bet,{dead:true,privateAudit:'secret'});
 assert.doesNotMatch(JSON.stringify(roulettePublic(r,a,73000)),/"dead"|auditPending|privateAudit|secret/);
});
