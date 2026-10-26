import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {resolve} from "node:path";
import {readFile} from "node:fs/promises";
import {z} from "zod";
import {buildPostBody,isTableScopedRoute} from "../lib/post-body";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/home/kit/out/cal-browser-evidence/node_modules/playwright");
const {build}=require("esbuild");
test("only routes that consume the table id receive it; blackjack keeps its own body",()=>{
 assert.deepEqual(buildPostBody("/api/action",{a:1},"02",5),{a:1,tableId:"02",requestAt:5});
 assert.deepEqual(buildPostBody("/api/blackjack",{tableId:"x"},"02",5),{tableId:"x",requestAt:5});
 for(const p of ["/api/admin","/api/finance","/api/roulette","/api/games","/api/transfers","/api/unknown"]){
  assert.equal(isTableScopedRoute(p),false,p);
  assert.deepEqual(buildPostBody(p,{a:1},"03",7),{a:1,requestAt:7},p);
 }
 assert.equal(isTableScopedRoute("/api/admin/../action"),false);
});
test("room-client posts through the shared helper and the admin route keeps its strict schema",async()=>{
 const client=await readFile("app/room-client.tsx","utf8");
 assert.ok(client.includes("buildPostBody(path,body,tableRef.current,Date.now())"));
 assert.ok(!/\{\.\.\.body,tableId:tableRef\.current/.test(client));
 const admin=await readFile("app/api/admin/route.ts","utf8");
 assert.match(admin,/z\.literal\("balance"\)[^;]*\.strict\(\)/);
});
test("real Admin Players balance submit produces a body the strict balance schema accepts",async()=>{
 const bundle=await build({stdin:{contents:`import React from "react";import {createRoot} from "react-dom/client";import {buildPostBody} from "./lib/post-body";import PlayersList from "./app/players-list";
 window.captured=[];
 const post=async(path,body)=>{window.captured.push({path,body:JSON.parse(JSON.stringify(buildPostBody(path,body,"01",1792984667983)))});};
 const users=[{publicId:"9edc9d8bb856e42e",name:"zurong",wallet:607600,netWorth:607600,holdings:[],positions:[]}];
 createRoot(document.getElementById("root")).render(<PlayersList users={users} busy={false} post={post} onRefresh={async()=>{}}/>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",loader:{".css":"empty",".module.css":"empty"},define:{"process.env.NEXT_PUBLIC_SSG_RELEASE":'"development"'},plugins:[{name:"mocks",setup(b:any){
  b.onResolve({filter:/^@clerk\/nextjs$/},()=>({path:"clerk",namespace:"mock"}));
  b.onLoad({filter:/.*/,namespace:"mock"},()=>({contents:"export function useAuth(){return {getToken:async()=>'t'}};export function useUser(){return {isLoaded:true,user:{id:'u'}}}",loader:"js"}));
 }}]});
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{channel:"chromium"})});
 try{
  const page=await browser.newPage();const errors:string[]=[];page.on("pageerror",(e:Error)=>errors.push(e.message));
  await page.route("https://admin.test/**",(r:any)=>r.fulfill({contentType:"text/html",body:'<!doctype html><meta charset="utf-8"><div id="root"></div>'}));
  await page.goto("https://admin.test");await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.getByRole("button",{name:/Adjust balance/}).click();
  await page.getByPlaceholder("+50 or -20").fill("5000");
  await page.getByRole("button",{name:"Review change"}).click();
  await page.getByRole("button",{name:"Confirm"}).click();
  await page.waitForFunction(()=>(window as any).captured.length===1,null,{timeout:5000}).catch(async(e:Error)=>{throw new Error(e.message+" | errors="+JSON.stringify(errors)+" | body="+(await page.locator("body").innerText()).slice(0,300));});
  const [{path,body}]=await page.evaluate(()=>(window as any).captured);
  assert.equal(path,"/api/admin");assert.equal("tableId" in body,false);
  assert.deepEqual(errors,[]);
  const stamp={requestId:z.string().uuid(),requestAt:z.number().int()};
  const balance=z.object({...stamp,type:z.literal("balance"),publicId:z.string().regex(/^[a-f0-9]{16}$/),delta:z.number().int()}).strict();
  assert.equal(balance.safeParse(body).success,true);
  assert.equal(balance.safeParse({...body,tableId:"01"}).success,false,"schema stays strict");
 }finally{await browser.close();}
});
