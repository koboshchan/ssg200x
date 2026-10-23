// Actual unchanged Recover caller in a fresh isolated component browser.
// Synthetic public test words only; no account keys, storage, reset, or saved profile.
import {readFileSync} from "node:fs";
import {build} from "esbuild";
import {createRequire} from "node:module";
import assert from "node:assert/strict";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/opt/hako/lib/node_modules/playwright");
async function main(){
 const source=readFileSync("app/chat-dock.tsx","utf8");
 const start=source.indexOf("function Recover("),end=source.indexOf("\nfunction Room(",start);
 assert.ok(start>=0&&end>start);
 const caller=source.slice(start,end);
 assert.match(caller,/<WordEntry value=\{words\} onChange=\{setWords\} count=\{6\} disabled=\{snap.busy\}/);
 const code=[
 'import React,{useState} from "react";import {createRoot} from "react-dom/client";',
 'import WordEntry from "./app/word-entry";',
 caller,
 'const expected="able about zoo wish able hello";',
 'window.recoveryCalls=0;window.recoveryMatches=false;',
 'const client={recover:async value=>{window.recoveryCalls++;window.recoveryMatches=value===expected;}};',
 'createRoot(document.getElementById("root")).render(<Recover snap={{busy:false}} client={client} err={null}/>);'
 ].join("\n");
 const bundled=await build({stdin:{contents:code,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,
 format:"iife",jsx:"automatic",loader:{".css":"empty"},define:{"process.env.NODE_ENV":'"production"'}});
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 let passed=0;
 try{
 for(const touch of [false,true]){
  const context=await browser.newContext({hasTouch:touch,viewport:{width:touch?390:1000,height:700}});
  const page=await context.newPage();let requests=0;const errors:string[]=[];
  page.on("request",()=>requests++);page.on("pageerror",(e:Error)=>errors.push(e.message));
  await page.setContent('<meta charset="utf-8"><div id="root"></div>');
  await page.addScriptTag({content:bundled.outputFiles[0].text});
  const input=page.getByRole("combobox",{name:"Six recovery words"});
  await input.fill("able about zoo wish able hel");
  const option=page.getByRole("option",{name:"hello",exact:true});await option.waitFor();
  if(touch)await option.tap();else{await input.press("ArrowDown");await input.press("Enter");}
  assert.equal(await input.inputValue(),"able about zoo wish able hello");
  assert.equal(await input.evaluate((el:HTMLInputElement)=>el.selectionStart),30);
  assert.equal(await page.evaluate(()=>Reflect.get(window,"recoveryCalls")),0);passed++;
  await input.press("Escape");await page.getByRole("button",{name:"Unlock",exact:true}).click();
  assert.equal(await page.evaluate(()=>Reflect.get(window,"recoveryCalls")),1);
  assert.equal(await page.evaluate(()=>Reflect.get(window,"recoveryMatches")),true);passed++;
  await input.fill("  ABLE\tabout  zoo wish able hello  ");
  assert.equal(await input.inputValue(),"  ABLE\tabout  zoo wish able hello  ");passed++;
  await input.fill("able about zoo wish able hello extra");
  assert.equal(await input.inputValue(),"able about zoo wish able hello extra");
  assert.equal(await input.getAttribute("aria-expanded"),"false");passed++;
  await input.fill("able-about zoo wish able hel");await input.press("Home");
  for(let i=0;i<10;i++)await input.press("ArrowRight");
  assert.equal(await input.getAttribute("aria-expanded"),"false");passed++;
  assert.equal(requests,0);assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>localStorage.length).catch(()=>0),0);passed++;
  await context.close();
 }
 console.log(JSON.stringify({passed,contexts:["desktop","touch"],actualUnchangedRecoverCaller:true,
 syntheticWordsOnly:true,networkRequests:0,pageErrors:0,scope:"component compatibility, not authenticated recovery"}));
 }finally{await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
