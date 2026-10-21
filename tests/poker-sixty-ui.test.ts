import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {freshRoom,register,applyAction,assertRoom,act,tick} from "../lib/poker";
import {publicRoom} from "../lib/public";
import {actionSchema} from "../lib/schemas";
import type {Action,Identity} from "../lib/types";
const require=createRequire(import.meta.url);
const {build}=require("esbuild");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/opt/hako/lib/node_modules/playwright");
const user=(i:number):Identity=>({id:"browser"+i,name:"Player "+i,email:i+"@test",admin:false});
test("real poker UI shows sixty-second rules and only the final thirty-second countdown on desktop/mobile",async()=>{
 const bundle=await build({entryPoints:["tests/fixtures/poker-black78-ui.tsx"],bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",loader:{".module.css":"empty"},plugins:[{name:"poker-ui-boundaries",setup(b:any){
  b.onResolve({filter:/^(next\/(dynamic|link|navigation)|@clerk\/nextjs|\.\/(live-provider|chat-dock|maintenance-gate))$/},(args:any)=>({path:args.path,namespace:"fixture"}));
  b.onLoad({filter:/.*/,namespace:"fixture"},(args:any)=>{
   if(args.path==="next/navigation")return {contents:"export const useRouter=()=>({replace(){}});export const usePathname=()=>'/poker';"};
   if(args.path==="./live-provider")return {contents:"export const useLive=()=>({connection:'connected'});export const useLiveEvent=()=>{};export const ConnectionBadge=()=>null;export default function Provider({children}){return children;}"};
   if(args.path==="@clerk/nextjs")return {contents:"export const useUser=()=>({isLoaded:true,isSignedIn:true,user:{id:'fixture'}});export const UserButton=()=>null;export const SignInButton=({children})=>children;"};
   if(args.path==="next/dynamic")return {contents:"export default ()=>()=>null;"};
   return {contents:"export default function Boundary({children}){return children??null;}"};
  });
 }}]});

 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||"/opt/hako/bin/chrome",args:["--no-sandbox"]});
 try{
  for(const width of [1440,390]){
   const r=freshRoom(),base=Date.now();
   for(let i=0;i<3;i++){register(r,user(i),base);applyAction(r,user(i),{type:"join",seat:i,buyIn:20000},base);}
   for(let i=0;i<3;i++)applyAction(r,user(i),{type:"ready"},base);
   assert.equal(r.deadline,base+60000);
   const viewer=user(r.turn!);
   const page=await browser.newPage({viewport:{width,height:1000}}),errors:string[]=[];
   page.on("pageerror",(e:Error)=>errors.push(e.message));
   await page.clock.install({time:base+999999999});
   let elapsed=0;
   await page.route("https://poker.test/**",async(route:any)=>{
    if(route.request().url().endsWith("/api/room")){
     const payload={...publicRoom(r,viewer),serverNow:base+elapsed};
     return route.fulfill({contentType:"application/json",body:JSON.stringify(payload)});
    }
    return route.fulfill({contentType:"text/html",body:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body><div id="root"></div></body></html>'});
   });
   async function mount(){
    await page.goto("https://poker.test/poker");await page.addStyleTag({content:readFileSync("app/globals.css","utf8")});await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.getByRole("region",{name:"Poker table"}).waitFor();
   }
   await mount();
   assert.match(await page.locator(".action-bar").innerText(),/60 seconds per turn/);
   assert.doesNotMatch(await page.locator(".table-message").innerText(),/ · \d+s/);
   elapsed=29999;await mount();assert.doesNotMatch(await page.locator(".table-message").innerText(),/ · \d+s/);
   elapsed=30000;await mount();assert.match(await page.locator(".table-message").innerText(),/ · 30s$/);
   await page.screenshot({path:"/home/kit/poker-sixty-evidence/countdown-"+width+".png",fullPage:true});
   elapsed=35000;await mount();assert.match(await page.locator(".table-message").innerText(),/ · 25s$/);
   assert.equal(r.deadline,base+60000);
   assert.deepEqual(errors,[]);await page.close();
  }
 }finally{await browser.close();}
});
