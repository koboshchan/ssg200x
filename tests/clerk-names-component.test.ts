import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {resolve} from "node:path";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/home/kit/out/cal-browser-evidence/node_modules/playwright");
const {build}=require("esbuild");
test("mounted Wallet preview/history and TableTalk own/historical messages rename from live server frames without reconnect",async()=>{
 const bundle=await build({stdin:{contents:`
 import React from "react";import {createRoot} from "react-dom/client";
 import Wallet from "./app/(room)/wallet/page";import ChatDock from "./app/chat-dock";import LiveProvider from "./app/live-provider";
 createRoot(document.getElementById("root")).render(<LiveProvider><Wallet/><ChatDock/></LiveProvider>);
 `,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",loader:{".module.css":"empty",".css":"empty"},plugins:[{name:"identity-fixtures",setup(b:any){
  b.onResolve({filter:/^@clerk\/nextjs$/},()=>({path:"auth",namespace:"mock"}));
  b.onLoad({filter:/auth/,namespace:"mock"},()=>({contents:'export function useAuth(){return {getToken:async()=>"test"}};export function useUser(){return {isLoaded:true,user:{id:"alice",firstName:"CLIENT SPOOF"}}}',loader:"js"}));
  b.onResolve({filter:/^next\/navigation$/},()=>({path:"navigation",namespace:"route-fixture"}));
  b.onLoad({filter:/.*/,namespace:"route-fixture"},()=>({contents:'export function usePathname(){return "/wallet"}',loader:"js"}));
  b.onResolve({filter:/^socket.io-client$/},()=>({path:resolve("tests/fixtures/wallet-socket.ts")}));
  b.onResolve({filter:/chat-client$/},()=>({path:"chat",namespace:"mock"}));
  b.onLoad({filter:/chat/,namespace:"mock"},()=>({contents:`
  const snapshot={phase:"ready",error:null,words:null,messages:[{key:"1",publicId:"alice-public",mine:true,status:"ok",text:"Own message",serverTs:1},{key:"2",publicId:"bob-public",mine:false,status:"ok",text:"Historical message",serverTs:2}],members:[],hasMore:false,busy:false,historyIncomplete:false};
  export class ChatClient {subscribe=()=>()=>{};getSnapshot=()=>snapshot;close(){};reconnect(){};hint(){}}
  `,loader:"js"}));
 }}]});
 const browser=await chromium.launch({headless:true,channel:"chromium"});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];
  page.on("pageerror",(e:Error)=>errors.push(e.message));
  let generation="Current",historyCalls=0;
  await page.route("https://names.test/**",async(route:any)=>{
   if(route.request().url().includes("/api/transfers")){
    const body=route.request().postDataJSON();
    if(body?.action==="resolve")await route.fulfill({json:{name:"Current Bob",publicId:"bob-public",amount:100,expiresAt:Date.now()+600000}});
    else{historyCalls++;await route.fulfill({json:{transfers:[{id:"1",amount:100,note:"",at:1,from:generation+" Alice",to:generation+" Bob",direction:"sent"}]}});}
   }else await route.fulfill({contentType:"text/html",body:'<!doctype html><meta charset="utf-8"><div id="root"></div>'});
  });
  await page.goto("https://names.test");await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.waitForFunction(()=>Boolean((window as any).walletSocket));
  const frame=(generation:string)=>page.evaluate((g:string)=>(window as any).walletSocket("room:state",{me:{wallet:10000,admin:false},chatNames:[{publicId:"alice-public",name:g+" Alice"},{publicId:"bob-public",name:g+" Bob"}],transferHistoryKeys:{mine:g,all:g}}),generation);
  await frame(generation);
  await page.getByPlaceholder("word word").fill("cat dog");await page.getByRole("button",{name:"Check code",exact:true}).click();
  await page.getByRole("button",{name:"Confirm send to Current Bob"}).waitFor();
  await page.locator(".chat-meta").filter({hasText:"Current Alice"}).waitFor();
  await page.locator(".chat-meta").filter({hasText:"Current Bob"}).waitFor();
  await page.getByRole("heading",{name:"Transfer history"}).waitFor();
  await page.getByText("To Current Bob",{exact:true}).waitFor();
  const before=historyCalls;generation="Renamed";await frame(generation);
  await page.getByRole("button",{name:"Confirm send to Renamed Bob"}).waitFor();
  await page.locator(".chat-meta").filter({hasText:"Renamed Alice"}).waitFor();
  await page.locator(".chat-meta").filter({hasText:"Renamed Bob"}).waitFor();
  await page.getByText("To Renamed Bob",{exact:true}).waitFor();assert.equal(historyCalls,before+1);
  const text=await page.locator("body").innerText();
  for(const stale of ["CLIENT SPOOF","Current Bob","Current Alice"])assert.equal(text.includes(stale),false,stale);
  assert.match(text,/Own message/);assert.match(text,/Historical message/);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
