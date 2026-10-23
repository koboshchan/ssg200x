// Isolated component harness, not a signed-in application acceptance gate.
import {build} from "esbuild";
import {createRequire} from "node:module";
import assert from "node:assert/strict";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/opt/hako/lib/node_modules/playwright");
const harness=[
'import React,{useState} from "react";',
'import {createRoot} from "react-dom/client";',
'import WordEntry from "./app/word-entry";',
'function Harness(){',
'const [value,setValue]=useState(""),[disabled,setDisabled]=useState(false),[readOnly,setReadOnly]=useState(false);',
'return <form onSubmit={e=>{e.preventDefault();document.querySelector("#submitted").textContent="submitted"}}>',
'<WordEntry value={value} onChange={setValue} count={3} separatorPattern={/[\\s-]/} disabled={disabled} readOnly={readOnly} label="Room code"/>',
'<button id="after" type="button">Next field</button>',
'<button type="button" id="disable" onClick={()=>setDisabled(!disabled)}>Disable</button>',
'<button type="button" id="readonly" onClick={()=>setReadOnly(!readOnly)}>Readonly</button>',
'<output id="submitted"/></form>;',
'}createRoot(document.getElementById("root")).render(<Harness/>);'
].join("\n");
async function main(){
const bundle=await build({
 stdin:{contents:harness,resolveDir:process.cwd(),loader:"tsx"},
 bundle:true,write:false,format:"iife",jsx:"automatic",loader:{".css":"empty"},
 define:{"process.env.NODE_ENV":'"production"'}
});
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
let passed=0;
try{
 for(const touch of [false,true]){
 const context=await browser.newContext({hasTouch:touch,viewport:{width:touch?390:1000,height:700}});
 const page=await context.newPage();let requests=0;
 page.on("request",()=>requests++);
 const errors:string[]=[];page.on("pageerror",(e:Error)=>errors.push(e.message));
 await page.setContent('<meta charset="utf-8"><div id="root"></div>');
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 const input=page.getByRole("combobox");
 await input.fill("hel");await input.press("ArrowDown");
 await page.waitForFunction(()=>document.querySelector('[role=combobox]')?.getAttribute("aria-activedescendant"));
 const active=await input.getAttribute("aria-activedescendant");
 assert.equal(await page.locator('[id="'+active+'"]').textContent(),"hello");
 await input.press("Enter");assert.equal(await input.inputValue(),"hello ");
 assert.equal(await page.locator("#submitted").textContent(),"");passed++;
 await input.fill("able--hel   zoo");await input.press("Home");for(let i=0;i<9;i++)await input.press("ArrowRight");
 await page.getByRole("option",{name:"hello",exact:true}).waitFor();
 if(touch)await page.getByRole("option",{name:"hello",exact:true}).tap();
 else await page.getByRole("option",{name:"hello",exact:true}).click();
 assert.equal(await input.inputValue(),"able--hello   zoo");
 assert.equal(await input.evaluate((el:HTMLInputElement)=>el.selectionStart),14);
 assert.equal(await input.evaluate((el:HTMLElement)=>document.activeElement===el),true);passed++;
 await input.fill("hel");await input.press("Escape");
 assert.equal(await input.getAttribute("aria-expanded"),"false");
 await input.press("ArrowUp");await input.press("Tab");
 assert.equal(await page.locator("#after").evaluate((el:HTMLElement)=>document.activeElement===el),true);
 assert.equal(await input.inputValue(),"hel");passed++;
 await input.focus();await input.fill("hel");
 await input.dispatchEvent("compositionstart");assert.equal(await input.getAttribute("aria-expanded"),"false");
 await input.press("ArrowDown");assert.equal(await input.inputValue(),"hel");
 await input.dispatchEvent("compositionend");await page.getByRole("option",{name:"hello",exact:true}).waitFor();passed++;
 await input.fill(" able   about zoo extra ");
 assert.equal(await input.inputValue()," able   about zoo extra ");
 assert.equal(await input.getAttribute("aria-expanded"),"false");passed++;
 await input.fill("hel");await input.press("Enter");
 assert.equal(await input.inputValue(),"hel");assert.equal(await page.locator("#submitted").textContent(),"submitted");passed++;
 await input.press("Escape");await page.locator("#readonly").click();await page.waitForFunction(()=>document.querySelector("input")?.readOnly);await input.focus();
 assert.equal(await input.getAttribute("aria-expanded"),"false");
 await input.press("ArrowDown");assert.equal(await input.inputValue(),"hel");
 await page.locator("#disable").click();await page.waitForFunction(()=>document.querySelector("input")?.disabled);assert.equal(await input.isDisabled(),true);passed++;
 assert.equal(requests,0);assert.deepEqual(errors,[]);passed++;
 await context.close();
 }
 console.log(JSON.stringify({passed,contexts:["desktop","touch"],networkRequests:0,pageErrors:0,scope:"isolated component only"}));
}catch(error){console.error({passed});throw error;}finally{await browser.close();}

}
void main().catch(error=>{console.error(error);process.exitCode=1;});
