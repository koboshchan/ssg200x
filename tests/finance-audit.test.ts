import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {financeAuditSnapshot} from "../lib/finance-audit";
import type {Position} from "../lib/finance";
test("finance audit snapshot explicitly includes request, execution basis and trigger values without arbitrary identity fields",()=>{
 const p={id:"position",symbol:"BTC",side:"long",margin:1000,leverage:200,entry:100000000,opened:100,takeProfit:100250000,email:"private@test",name:"Private"} as Position;
 assert.deepEqual(financeAuditSnapshot("request","Manual",p,100100000),{openingFeePpm:0,closingFeePpm:0,openingFee:0,requestId:"request",positionId:"position",reason:"Manual",entry:100000000,mark:100100000,margin:1000,leverage:200,trigger:{takeProfit:100250000,stopLoss:null}});
 assert.equal(financeAuditSnapshot("request","Triggers",p,null).mark,null);
});
test("finance receipt replay exits before every audited mutation and uses existing durable audit queue",()=>{
 const source=readFileSync(new URL("../app/api/finance/route.ts",import.meta.url),"utf8");
 const replay=source.indexOf('if(checkFinanceRequest(r,who.id,input))return;');
 assert.ok(replay>0);
 for(const kind of ["finance-open","finance-triggers","finance-close"])assert.ok(source.indexOf('"'+kind+'"')>replay);
 assert.ok(source.includes('import {audit} from "@/lib/audit"'));
});
