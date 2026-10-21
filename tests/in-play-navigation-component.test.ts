import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {resolve} from "node:path";
import {readFileSync} from "node:fs";
import {freshRoom,register,applyAction} from "../lib/poker";
import {blackjackTablesAction} from "../lib/blackjack";
import {rouletteState,rouletteAction,roulettePublic} from "../lib/roulette";
import {publicRoom} from "../lib/public";
import type {PublicRoom} from "../lib/public";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/home/kit/out/cal-browser-evidence/node_modules/playwright");
const {build}=require("esbuild");
const who={id:"guard-user",name:"A",email:"a@test.invalid",admin:false};
function snapshots(){
 const room=freshRoom();register(room,who);
 const empty=publicRoom(room,who);
 applyAction(room,who,{type:"join",seat:0,buyIn:20000},0);
 const poker=publicRoom(room,who);
 blackjackTablesAction(room,who,{type:"join",tableId:"lounge",seat:0},0);
 blackjackTablesAction(room,who,{type:"bet",tableId:"lounge",amount:5000},0);
 const blackjack=publicRoom(room,who);
 rouletteState(room,1000);rouletteAction(room,who,{type:"bet",bet:{kind:"red",amount:2500}},1,"mine",1000);
 const roulette=publicRoom(room,who);roulette.roulette=roulettePublic(room,who,1000);
 return {empty,poker,blackjack,roulette};
}
test("mounted live guard intercepts client links for all games, preserves navigation semantics and never writes money",async()=>{
 const bundle=await build({stdin:{contents:`
 import React from "react";import {createRoot} from "react-dom/client";
 import Guard from "./app/in-play-navigation";import LiveProvider from "./app/live-provider";
 import {usePathname,useRouter} from "next/navigation";
 function App(){const path=usePathname(),router=useRouter();const link=(href,id,text,props={})=><a id={id} href={href} {...props} onClick={e=>{if(!e.defaultPrevented&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey&&e.button===0&&!props.target&&!props.download){e.preventDefault();router.push(href)}}}>{text}</a>;return <LiveProvider><header>{link("/wallet?from=header#send","header","Wallet")}</header><aside>{link("/markets","sidebar","Markets")}</aside><main><output id="path">{path}</output>{link(path+"#same","same","Same page")}{link("/wallet","blank","New tab",{target:"_blank"})}{link("/wallet","download","Download",{download:"receipt"})}<a id="external" href="https://elsewhere.test/">External</a>{link("/wallet","modified","Modified")}</main><Guard/></LiveProvider>}
 createRoot(document.getElementById("root")).render(<App/>);
 `,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",loader:{".css":"empty"},plugins:[{name:"guard-fixtures",setup(b:any){
 b.onResolve({filter:/^@clerk\/nextjs$/},()=>({path:"auth",namespace:"fixture"}));
 b.onLoad({filter:/auth/,namespace:"fixture"},()=>({contents:'export function useAuth(){return {getToken:async()=>"test"}}',loader:"js"}));
 b.onResolve({filter:/^next\/navigation$/},()=>({path:"navigation",namespace:"fixture"}));
 b.onLoad({filter:/navigation/,namespace:"fixture"},()=>({contents:`
 import {useSyncExternalStore} from "react";
 const listeners=new Set();window.navPushes=[];
 function push(href){window.navPushes.push(href);history.pushState(null,"",href);listeners.forEach(f=>f())}
 window.setRoute=href=>{history.replaceState(null,"",href);listeners.forEach(f=>f())};
 export function usePathname(){return useSyncExternalStore(f=>{listeners.add(f);return()=>listeners.delete(f)},()=>location.pathname)}
 export function useRouter(){return {push}}
 `,loader:"js",resolveDir:process.cwd()}));
 b.onResolve({filter:/^socket.io-client$/},()=>({path:resolve("tests/fixtures/wallet-socket.ts")}));
 }}]});
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{channel:"chromium"})});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors:string[]=[],requests:string[]=[];
 page.on("pageerror",(e:Error)=>errors.push(e.message));
 page.on("dialog",(dialog:any)=>{errors.push("unexpected browser dialog "+dialog.type());dialog.dismiss();});
 await page.route("https://guard.test/**",async(route:any)=>{requests.push(route.request().method()+" "+route.request().url());await route.fulfill({contentType:"text/html",body:'<!doctype html><meta charset="utf-8"><div id="root"></div>'});});
 await page.goto("https://guard.test/poker");
 await page.addStyleTag({content:readFileSync("app/globals.css","utf8")+"\n"+readFileSync("app/in-play-navigation.css","utf8")});
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.waitForFunction(()=>Boolean((window as any).walletSocket));
 const fixtures=snapshots();let version=1;
 const frame=async(snapshot:PublicRoom)=>{await page.evaluate((s:any)=>(window as any).walletSocket("room:state",s),{...snapshot,version:version++});};
 const route=async(path:string)=>{await page.evaluate((p:string)=>(window as any).setRoute(p),path);await page.waitForFunction((p:string)=>document.querySelector("#path")?.textContent===p,path);};
 const dialog=page.getByRole("dialog"),stay=page.getByRole("button",{name:"Stay",exact:true});
 for(const [path,key,amount] of [["/poker","poker","200"],["/blackjack","blackjack","50"],["/roulette","roulette","25"]] as const){
  await route(path);await frame(fixtures[key]);await page.locator("#header").click();
  await dialog.waitFor();assert.equal(await page.locator("#path").textContent(),path);
  assert.equal(await page.locator("#in-play-navigation-title").textContent(),"You have $"+amount+" in play, leave anyway?");
  assert.equal(await stay.evaluate((e:HTMLElement)=>e===document.activeElement),true);
  await stay.click();assert.equal(await dialog.count(),0);assert.equal(await page.locator("#path").textContent(),path);
  assert.equal(await page.locator("#header").evaluate((e:HTMLElement)=>e===document.activeElement),true);
  await page.locator("#sidebar").click();await dialog.waitFor();await page.keyboard.press("Escape");
  assert.equal(await dialog.count(),0);assert.equal(await page.locator("#path").textContent(),path);
  await page.locator("#header").click();await page.getByRole("button",{name:"Leave",exact:true}).click();
  await page.waitForFunction(()=>location.pathname==="/wallet");assert.equal(new URL(page.url()).search,"?from=header");assert.equal(new URL(page.url()).hash,"#send");
 }
 // A single live subscription protects all routes; off-page poker exposure never guards Markets.
 await route("/markets");await page.locator("#header").click();await page.waitForFunction(()=>location.pathname==="/wallet");assert.equal(await dialog.count(),0);
 await route("/poker");await frame(fixtures.empty);await page.locator("#header").click();await page.waitForFunction(()=>location.pathname==="/wallet");assert.equal(await dialog.count(),0);
 await route("/poker");await frame(fixtures.poker);await page.locator("#same").click();assert.equal(await dialog.count(),0);
 // Capture only intercepts ordinary current-tab internal navigations. Prevent defaults at
 // bubble time in this probe so new tabs/downloads/external URLs aren't actually opened.
 for(const [id,options] of [["blank",{}],["download",{}],["external",{}],["modified",{ctrlKey:true}],["modified",{metaKey:true}],["modified",{shiftKey:true}],["modified",{altKey:true}],["modified",{button:1}]] as const){
  const prevented=await page.evaluate(({id,options}:any)=>{let wasPrevented=false;document.addEventListener("click",(e:MouseEvent)=>{wasPrevented=e.defaultPrevented;e.preventDefault();},{once:true});document.getElementById(id)!.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,...options}));return wasPrevented;},{id,options});
  assert.equal(prevented,false,id);assert.equal(await dialog.count(),0);
 }
 // Dynamic document anchors are covered as well as React header/sidebar links.
 await page.evaluate(()=>{const a=document.createElement("a");a.id="document-link";a.href="/settings";a.textContent="Settings";document.body.append(a)});
 await page.locator("#document-link").click();await dialog.waitFor();
 // Live changes update the displayed amount and zero never silently follows the target.
 const changed=structuredClone(fixtures.poker);changed.seats[0]!.stack=12345;await frame(changed);
 await page.getByRole("heading",{name:"You have $123.45 in play, leave anyway?",exact:true}).waitFor();
 await frame(fixtures.empty);await page.getByRole("heading",{name:"You have $0 in play, leave anyway?",exact:true}).waitFor();
 assert.equal(await page.locator("#path").textContent(),"/poker");
 await stay.click();assert.equal(await page.locator("#path").textContent(),"/poker");
 // Old room frames cannot roll back a newer zero balance.
 await page.evaluate((s:any)=>(window as any).walletSocket("room:state",{...s,version:0}),fixtures.poker);
 await page.locator("#header").click();await page.waitForFunction(()=>location.pathname==="/wallet");assert.equal(await dialog.count(),0);
 // Route changes not initiated by guarded links dismiss a stale captured destination.
 await route("/poker");await frame(fixtures.poker);await page.locator("#sidebar").click();await dialog.waitFor();await route("/settings");
 assert.equal(await dialog.count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);assert.equal(requests.some(s=>s.startsWith("POST ")),false);
 }finally{await browser.close();}
});
