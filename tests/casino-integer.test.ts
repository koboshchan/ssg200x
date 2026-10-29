import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {casinoInputCents,isWholeCasinoAmount,isCasinoInputText} from "../lib/casino-amount";
import {wholeCasinoCents,rouletteBetSchema} from "../lib/casino-schemas";
import {actionSchema} from "../lib/schemas";
import {rouletteRequestSchema} from "../lib/roulette-request";
import {freshRoom,register,applyAction,act,totalChips} from "../lib/poker";
import {blackjackAction,blackjackTablesAction} from "../lib/blackjack";
import {rouletteState,rouletteAction,rouletteTick} from "../lib/roulette";
import {payout,spin} from "../lib/finance";
const a={id:"a",name:"A",email:"a@example.test",admin:true};
const b={...a,id:"b",name:"B"};
const base={requestId:"123e4567-e89b-42d3-a456-426614174000",requestAt:1000,handNumber:0,turnDeadline:null};
const invalid=[101,150,199,100.5,NaN,Infinity,-Infinity,"100","1e2","100.00",null,{},true];
test("whole-dollar boundary checks cents, not just integer transport",()=>{
 for(const n of invalid){assert.equal(isWholeCasinoAmount(n),false,String(n));assert.equal(wholeCasinoCents.safeParse(n).success,false,String(n));}
 for(const n of [0,100,1000,100000]){assert.equal(isWholeCasinoAmount(n),true);assert.equal(wholeCasinoCents.safeParse(n).success,true);}
 // JSON number exponent syntax has already become a number; numeric equivalents are consistent.
 assert.equal(wholeCasinoCents.parse(JSON.parse("1e2")),100);
 assert.equal(wholeCasinoCents.parse(JSON.parse("100.0")),100);
 assert.equal(wholeCasinoCents.safeParse(JSON.parse("1.5e2")).success,false);
});
test("input refuses decimal, exponent, commas and non-finite syntax without truncation",()=>{
 for(const s of ["1.5","1.00",".5","1,5","1,000","1e2","1E2","+1","-1"," 1","1 ","NaN","Infinity","0x10","１２","1\n","9007199254740991"]){assert.equal(casinoInputCents(s),null,s);}
 assert.equal(casinoInputCents(""),null);
 assert.equal(isCasinoInputText(""),true);
 for(const s of ["0","1","001","1000"]){assert.equal(casinoInputCents(s),Number(s)*100);}
 for(const s of ["1.5","1,5","1e2",".",","]){assert.equal(isCasinoInputText(s),false);}
});
test("roulette and poker request schemas reject fractional dollars and preserve limits",()=>{
 for(const amount of invalid)assert.equal(rouletteBetSchema.safeParse({kind:"red",amount}).success,false);
 for(const amount of [99,100001,0,-100])assert.equal(rouletteBetSchema.safeParse({kind:"red",amount}).success,false);
 for(const amount of [100,100000])assert.equal(rouletteBetSchema.safeParse({kind:"red",amount}).success,true);
 for(const to of invalid)assert.equal(actionSchema.safeParse({...base,type:"raise",to}).success,false);
 for(const buyIn of [10001,10050,"10000",3999,100000100])assert.equal(actionSchema.safeParse({...base,type:"join",seat:0,buyIn}).success,false);
 for(const buyIn of [4000,10000,20000])assert.equal(actionSchema.safeParse({...base,type:"join",seat:0,buyIn}).success,true);
 const request={type:"bet",tableId:"01",requestId:base.requestId,requestAt:base.requestAt,round:1};
 for(const amount of [...invalid,99,100001,0,-100])assert.equal(rouletteRequestSchema.safeParse({...request,bet:{kind:"red",amount}}).success,false);
 for(const amount of [100,100000])assert.equal(rouletteRequestSchema.safeParse({...request,bet:{kind:"red",amount}}).success,true);
 assert.match(readFileSync("app/api/roulette/route.ts","utf8"),/rouletteRequestSchema as schema/);
 for(const f of ["lib/roulette-request.ts","lib/finance-input.ts"]){
  assert.match(readFileSync(f,"utf8"),/casino-schemas/);
 }
});
test("blackjack legacy and all table boundaries reject fractional cents and invalid limits with exact financial no-op",()=>{
 for(const tableId of [null,"lounge","salon","terrace"] as const){
  const r=freshRoom();register(r,a,0);
  if(tableId)blackjackTablesAction(r,a,{tableId,type:"join",seat:0},0);else blackjackAction(r,a,{type:"join",seat:0},0);
  for(const amount of [...invalid.filter(n=>!(typeof n==="number"&&Number.isSafeInteger(n)&&n>=100&&n<=100000)),0,99,100001]){
   const before=structuredClone(r);
   assert.throws(()=>tableId?blackjackTablesAction(r,a,{tableId,type:"bet",amount:amount as number},0):blackjackAction(r,a,{type:"bet",amount:amount as number},0));
   assert.deepEqual(r,before);
  }
  if(tableId)blackjackTablesAction(r,a,{tableId,type:"bet",amount:100},0);else blackjackAction(r,a,{type:"bet",amount:100},0);
  assert.equal(r.members[0].wallet,99900);
 }
});
test("roulette new/change/rebet reject fractional dollars but settle legacy wagers unchanged",()=>{
 const r=freshRoom();register(r,a,0);rouletteState(r,0);
 rouletteAction(r,a,{type:"bet",bet:{kind:"red",amount:100}},1,"one",0);
 for(const amount of invalid)for(const type of ["bet","change"] as const){
  const before=structuredClone(r);
  assert.throws(()=>rouletteAction(r,a,{type,betId:"one",bet:{kind:"red",amount:amount as number}},1,"bad",0));assert.deepEqual(r,before);
 }
 const legacy=rouletteState(r,0);legacy.bets[0].bet.amount=150;r.members[0].wallet-=50;
 assert.equal(payout({kind:"red",amount:150},1),300);
 rouletteTick(r,60000,()=>1);assert.equal(r.members[0].wallet,100150);
 rouletteTick(r,77000,()=>1);const before=structuredClone(r);
 assert.throws(()=>rouletteAction(r,a,{type:"rebet"},2,"repeat",77000));assert.deepEqual(r,before);
});
test("poker join/raise reject decimal amounts before mutation, preserve fractional pots",()=>{
 const r=freshRoom();register(r,a,0);register(r,b,0);
 for(const buyIn of [10001,10050,10000.5,"10000",NaN,Infinity]){
  const before=structuredClone(r);assert.throws(()=>applyAction(r,a,{type:"join",seat:0,buyIn:buyIn as number},0));assert.deepEqual(r,before);
 }
 applyAction(r,a,{type:"join",seat:0,buyIn:10000},0);applyAction(r,b,{type:"join",seat:1,buyIn:10000},0);
 applyAction(r,a,{type:"ready"},0);applyAction(r,b,{type:"ready"},0);
 for(const to of [450,450.5,"500",NaN,Infinity]){
  const before=structuredClone(r);assert.throws(()=>act(r,r.seats[r.turn!]!.userId,{type:"raise",to:to as number},1));assert.deepEqual(r,before);
 }
 const chips=totalChips(r);act(r,r.seats[r.turn!]!.userId,{type:"raise",to:500},1);assert.equal(r.currentBet,500);assert.equal(totalChips(r),chips);
});
test("disabled legacy instant roulette still rejects non-integer bets if called internally",()=>{
 const r=freshRoom();register(r,a,0);spin(r,a,[{kind:"red",amount:100}],1,"ok",2000);
 for(const amount of [150,100.5,NaN,Infinity]){const before=structuredClone(r);assert.throws(()=>spin(r,a,[{kind:"red",amount}],1,"bad",4000));assert.deepEqual(r,before);}
});
