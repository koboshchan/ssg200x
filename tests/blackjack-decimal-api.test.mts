import test,{mock} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register} from "../lib/poker.ts";
import {blackjackTablesAction,blackjackTablesPublic} from "../lib/blackjack.ts";
const who={id:"qa-decimal",name:"Alice",email:"a@example.test",admin:false};
const r=freshRoom();register(r,who,0);blackjackTablesAction(r,who,{type:"join",seat:0,tableId:"lounge"},0);
mock.module("../lib/api.ts",{namedExports:{endpoint:async(request:Request,handler:any)=>{try{return Response.json(await handler(who));}catch(error:any){return Response.json({error:error.message},{status:400});}},parse:async(request:Request,schema:any)=>schema.parse(await request.json())}});
mock.module("../lib/store.ts",{namedExports:{rateLimit:async()=>{}}});
mock.module("../lib/public.ts",{namedExports:{freshPublicRoom:async(room:any,user:any)=>({blackjack:blackjackTablesPublic(room,user),me:{wallet:room.members[0].wallet}})}});
mock.module("../lib/blackjack-store.ts",{namedExports:{blackjackMove:async(user:any,input:any)=>{blackjackTablesAction(r,user,input,0);return r;}}});
const {POST}=await import("../app/api/blackjack/route.ts");
const body=(amount:unknown,extra={})=>({type:"bet",amount,tableId:"lounge",requestId:"e3fb6085-d5f8-4779-a8f6-5ed2fba9c9b7",requestAt:0,...extra});
const post=(value:any)=>POST(new Request("https://example.test/api/blackjack",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(value)}));
test("real blackjack route accepts exact-cent wagers with identical response shape and no internal fields",async()=>{
 const whole=await post(body(200,{chips:[100,100]})),fraction=await post(body(101));assert.equal(whole.status,200);assert.equal(fraction.status,200);
 const a=await whole.json(),b=await fraction.json();assert.deepEqual(Object.keys(a),Object.keys(b));assert.deepEqual(Object.keys(a.blackjack.tables[0]),Object.keys(b.blackjack.tables[0]));assert.equal(b.me.wallet,99899);assert.equal(b.blackjack.tables[0].seats[0].bet,101);assert.doesNotMatch(JSON.stringify(b),/private|policy|shoe|audit|weighted|branch/i);
});
test("real request schema rejects fractional cents, range violations and client-selected policy or seed without debit",async()=>{
 for(const amount of [100.1,0,99,100001,"101",null]){const wallet=r.members[0].wallet;assert.equal((await post(body(amount))).status,400);assert.equal(r.members[0].wallet,wallet);}
 for(const extra of [{privatePolicy:true},{seed:1},{privateCards:["As","Ks"]}]){const wallet=r.members[0].wallet;assert.equal((await post(body(101,extra))).status,400);assert.equal(r.members[0].wallet,wallet);}
});

test("API accepts malformed composition with the normal ACK, never a public policy error",async()=>{
 for(const chips of [null,{},[],[200],[100],[-100,700],[100,"500"],"600"]){
  const response=await post(body(600,{chips}));assert.equal(response.status,200);const result=await response.json();assert.equal(result.me.wallet,99400);assert.doesNotMatch(JSON.stringify(result),/private|policy|audit|composition|shoe/i);
 }
 for(const [amount,chips] of [[200,[100,100]],[600,[100,500]],[2500,[500,2000]]]){const response=await post(body(amount,{chips}));assert.equal(response.status,200);assert.equal((await response.json()).me.wallet,100000-Number(amount));}
});
