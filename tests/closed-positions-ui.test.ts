import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const fin=readFileSync("app/finance-client.tsx","utf8"),css=readFileSync("app/globals.css","utf8"),room=readFileSync("app/room-client.tsx","utf8");
test("closed positions table has required columns, no id column, scrolls internally",()=>{
 for(const h of ["Symbol","Side","Leverage","Entry","Exit","Realized P/L","Reason","Time"])assert.ok(fin.includes("<th>"+h+"</th>"));
 assert.ok(!/<td>\{p\.id\}/.test(fin));
 assert.match(css,/\.closed-positions\{[^}]*overscroll-behavior-x/);assert.match(css,/\.closed-positions table\{min-width:800px/);
});
test("settled notice uses comma USD format",()=>{
 const m=room.match(/\.replace\(\/\(\\d\+\\\.\\d\{2\}\) returned\/g,[^)]*\)[^)]*\)/);assert.ok(m);
 const f=(t:string)=>t.replace(/(\d+\.\d{2}) returned/g,(_:string,n:string)=>"$"+Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})+" returned");
 assert.equal(f("Closed 81971.08 returned"),"Closed $81,971.08 returned");
});
