import assert from "node:assert/strict";
import {build} from "esbuild";
import {createRequire} from "node:module";
import {freshRoom,register,assertRoom} from "../lib/poker";
import {rouletteAction,rouletteTick,rouletteState} from "../lib/roulette";
import {publicRoom} from "../lib/public";
import {ROULETTE_CHIPS} from "../lib/roulette-chips";
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||"/home/kit/tools/playwright");
const who={id:"qa",name:"Alice",email:"qa@example.test",admin:false};
async function main(){
 const r=freshRoom();const start=Date.now();register(r,who,start);rouletteState(r,start);const posts:any[]=[];
 const bundle=await build({stdin:{contents:`
 import React,{useState} from "react";import {createRoot} from "react-dom/client";import Roulette from "./app/roulette-client";
 function Harness(){const [room,setRoom]=useState(window.initialRoom);window.updateRoom=setRoom;return <Roulette room={room} busy={false} post={async(path,body)=>{const updated=await window.postAction(body);window.qaPostCount=(window.qaPostCount||0)+1;setRoom(updated)}}/>}
 createRoot(document.getElementById("root")).render(<Harness/>);
 `,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",loader:{".module.css":"empty"}});
 const browser=await chromium.launch({headless:true,channel:"chromium"});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];page.on("pageerror",(e:Error)=>errors.push(e.message));
  await page.exposeFunction("postAction",async(body:any)=>{posts.push(body);rouletteAction(r,who,body,body.round,body.requestId,rouletteState(r,0).started+1000);assertRoom(r);return publicRoom(r,who);});
  await page.addInitScript(()=>{(window as any).qaPostCount=0});
  await page.exposeFunction("postCount",()=>posts.length);
  await page.route('https://roulette.test/**',(route:any)=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><div id="root"></div>'}));await page.goto('https://roulette.test');
  await page.evaluate((room:any)=>{(window as any).initialRoom=room},publicRoom(r,who));await page.addScriptTag({content:bundle.outputFiles[0].text});
  for(const chip of ROULETTE_CHIPS){
   await page.getByRole("button",{name:"$"+chip.value+" chip",exact:true}).click();
   const count=posts.length;await page.getByRole("button",{name:"Bet $"+chip.value+" on Red",exact:true}).click();
   await page.waitForFunction((n:number)=>(window as any).qaPostCount>=n,count+1);
  }
  assert.deepEqual(posts.map(p=>p.bet.amount),ROULETTE_CHIPS.map(c=>c.value*100));assert.equal(r.auditPending?.length??0,0);
  while(rouletteState(r,0).bets.length){
   const count=posts.length;await page.getByRole("button",{name:"Cancel red bet",exact:true}).first().click();await page.waitForFunction((n:number)=>(window as any).qaPostCount>=n,count+1);
  }
  assert.equal(r.members[0].wallet,100000);assert.equal(r.auditPending?.length??0,0);
  // Three valid $1 clicks aggregate to a non-default $3 total, but retain three live placements.
  await page.getByRole("button",{name:"$1 chip",exact:true}).click();
  for(let i=0;i<3;i++){const count=posts.length;await page.getByRole("button",{name:"Bet $1 on Red",exact:true}).click();await page.waitForFunction((n:number)=>(window as any).qaPostCount>=n,count+1);}
  // Server-injected custom placement looks exactly like other chips, with no public flag.
  rouletteAction(r,who,{type:"bet",bet:{kind:"red",amount:300}},1,"custom",start+1000);
  await page.evaluate((room:any)=>(window as any).updateRoom(room),publicRoom(r,who));
  assert.equal(await page.getByText("red · $3",{exact:true}).count(),1);
  assert.doesNotMatch(await page.locator("body").innerText(),/dead|forfeit|custom|invalid|audit/i);
  rouletteTick(r,start+60000,()=>1);rouletteTick(r,start+77000,()=>1);rouletteState(r,0).started=Date.now();
  await page.evaluate((room:any)=>(window as any).updateRoom(room),publicRoom(r,who));
  const count=posts.length;await page.getByRole("button",{name:/^Last bet/}).click();
  await page.waitForFunction((n:number)=>(window as any).qaPostCount>=n,count+1);
  assert.deepEqual(rouletteState(r,0).bets.map(w=>w.bet.amount),[100,100,100]);assert.ok(rouletteState(r,0).bets.every(w=>!w.dead));
  assert.equal(r.auditPending!.length,1);assert.deepEqual(errors,[]);
  await page.screenshot({path:"/home/kit/out/integer-bets/roulette-mounted.png",fullPage:true});
  console.log("Mounted actual Roulette PASS all chip denominations, click payloads, cancellation refunds, normal custom rendering, legitimate Last bet chip multiset, no private hints");
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
