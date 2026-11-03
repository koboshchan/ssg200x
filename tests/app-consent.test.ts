import {test} from "node:test";
import assert from "node:assert/strict";
import {api,toCents,toDollars,type Scope} from "../app/app-api-client";
import {limitText,parseLimits} from "../app/limit-fields";
import {consentBody,creditHint,hasMoneyScope,type LinkPreview} from "../app/app-consent";

function preview(mode:"mint"|"refunds"|undefined="mint"):LinkPreview{
 return {confirmation_token:"confirmation",app:{app_id:"app",name:"Test",description:"",website:"https://example.test",status:"approved",credit_mode:mode},external_subject:"external",requested_scopes:["profile","balance:read","balance:debit","balance:credit"],limits:{per_operation_cents:100000,daily_cents:500000,lifetime_cents:5000000},expires_at:"2027-01-01T00:00:00Z"};
}
test("decimal play-money text converts to exact whole cents",()=>{
 for(const [text,cents] of [["0",0],["0.01",1],["0.1",10],["1.01",101],["25.50",2550],[" 25.50 ",2550],["0001.20",120],["999999999.99",99999999999]] as const)assert.equal(toCents(text),cents,text);
 for(const text of [""," ","-1","+1","1e2","1,000","1.001",".50","1.","1 0","NaN","Infinity","1000000000","$1","１２"])assert.equal(toCents(text),null,text);
 for(const cents of [0,1,10,99,100,2550,100000,99999999999])assert.equal(toCents(toDollars(cents)),cents);
});
test("limit parsing enforces each cap and hierarchy, allowing zero",()=>{
 const p=preview(),t=limitText(p.limits);
 assert.deepEqual(parseLimits(t,p.limits),{limits:p.limits});
 for(const key of ["per_operation_cents","daily_cents","lifetime_cents"] as const){
  assert.ok(parseLimits({...t,[key]:toDollars(p.limits[key]+1)},p.limits).error);
  assert.ok(parseLimits({...t,[key]:"0.001"},p.limits).error);
 }
 assert.ok(parseLimits({...t,per_operation_cents:"5001"},p.limits).error);
 assert.ok(parseLimits({...t,lifetime_cents:"1000"},p.limits).error);
 assert.deepEqual(parseLimits({per_operation_cents:"0",daily_cents:"0",lifetime_cents:"0"},p.limits).limits,{per_operation_cents:0,daily_cents:0,lifetime_cents:0});
});
test("credit-only mint consent retains reviewed nonzero limits",()=>{
 const p=preview(),scopes:Scope[]=["balance:credit"],text=limitText(p.limits);
 assert.equal(hasMoneyScope(scopes,"mint"),true);
 assert.deepEqual(consentBody(p,scopes,text,false),{confirmation_token:"confirmation",scopes:["balance:credit"],limits:p.limits});
 const body=consentBody(p,scopes,text,false);
 scopes.push("balance:debit");text.daily_cents="0";p.limits.daily_cents=1;
 assert.deepEqual(body.scopes,["balance:credit"]);
 assert.equal(body.limits.daily_cents,500000);
});
test("authorization never adds scopes and requires acknowledged debit",()=>{
 const p=preview(),text=limitText(p.limits);
 assert.throws(()=>consentBody(p,["balance:debit"],text,false),/Confirm/);
 assert.deepEqual(consentBody(p,["profile","balance:debit"],text,true).scopes,["profile","balance:debit"]);
 assert.throws(()=>consentBody(p,[],text,true),/Select/);
 assert.throws(()=>consentBody(p,["profile","profile"],text,true),/Select/);
 p.requested_scopes=["profile"];
 assert.throws(()=>consentBody(p,["balance:read"],text,true),/Select/);
 assert.equal(hasMoneyScope(["profile","balance:read"]),false);
 assert.deepEqual(consentBody(p,["profile"],text,false).limits,p.limits);
});
test("refund-only copy does not promise rewards; missing mode fails closed",()=>{
 assert.match(creditHint("refunds"),/Refunds only/);
 assert.equal(hasMoneyScope(["balance:credit"],"refunds"),false);
 assert.equal(hasMoneyScope(["balance:credit"]),false);
 assert.equal(hasMoneyScope(["balance:debit"],"refunds"),true);
 assert.match(creditHint("refunds"),/cannot create rewards/);
 assert.match(creditHint("mint"),/create play-money rewards/);
 assert.match(creditHint(),/not provided/);
 const p=preview();delete p.app.credit_mode;
 assert.throws(()=>consentBody(p,["balance:credit"],limitText(p.limits),false),/credit policy/);
 p.app.credit_mode="refunds";
 assert.deepEqual(consentBody(p,["balance:credit"],limitText(p.limits),false).scopes,["balance:credit"]);
});
test("second reduction is validated against the returned grant limits",()=>{
 const p=preview(),old=limitText(p.limits),returned={per_operation_cents:100,daily_cents:500,lifetime_cents:1000};
 assert.ok(parseLimits(old,returned).error);
 assert.deepEqual(parseLimits(limitText(returned),returned).limits,returned);
 const reduced={...limitText(returned),per_operation_cents:"0.50"};
 assert.equal(parseLimits(reduced,returned).limits?.per_operation_cents,50);
});
test("browser write contract sends JSON snapshots and DELETE body",async()=>{
 const original=globalThis.fetch,calls:{url:string;init?:RequestInit}[]=[];
 globalThis.fetch=async(input,init)=>{
  calls.push({url:String(input),init});
  return new Response(JSON.stringify({grant:{grant_id:"grant"}}),{status:200,headers:{"content-type":"application/json"}});
 };
 try{
  const p=preview(),body=consentBody(p,["balance:credit"],limitText(p.limits),false);
  await api("/api/app-links/authorize",{method:"POST",body});
  assert.equal(calls[0].init?.method,"POST");
  assert.equal((calls[0].init?.headers as Record<string,string>)["content-type"],"application/json");
  assert.equal(calls[0].init?.cache,"no-store");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)),body);
  await api("/api/app-links/grant",{method:"DELETE",body:{}});
  assert.equal(calls[1].init?.body,"{}");
  await api("/api/app-links");
  assert.equal(calls[2].init?.body,undefined);
 }finally{globalThis.fetch=original;}
});
test("browser API surfaces failed or invalid server JSON without pretending success",async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response(JSON.stringify({error:"Confirmation expired"}),{status:409});
  await assert.rejects(api("/api/app-links/authorize",{method:"POST",body:{}}),e=>e instanceof Error&&e.message==="Confirmation expired"&&(e as Error&{status:number}).status===409);
  globalThis.fetch=async()=>new Response("not json",{status:502});
  await assert.rejects(api("/api/app-links"),/Something went wrong/);
 }finally{globalThis.fetch=original;}
});
