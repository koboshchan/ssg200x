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
test("mounted poker Ready, Unready, ready cashout, active lock and fresh next-hand consent",async()=>{
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
   const r=freshRoom();const now=Date.now();
   for(let i=0;i<2;i++){register(r,user(i),now);applyAction(r,user(i),{type:"join",seat:i,buyIn:20000},now);}
   const page=await browser.newPage({viewport:{width,height:1000}}),errors:string[]=[],posts:string[]=[];
   page.on("pageerror",(e:Error)=>errors.push(e.message));
   await page.route("https://poker.test/**",async(route:any)=>{
    const request=route.request();
    if(request.url().endsWith("/api/action")){
     const action=actionSchema.parse(request.postDataJSON());
     assert.equal(action.handNumber,r.handNumber);posts.push(action.type);
     applyAction(r,user(0),action as Action,Date.now());r.version++;assertRoom(r);
     return route.fulfill({contentType:"application/json",body:JSON.stringify(publicRoom(r,user(0)))});
    }
    if(request.url().endsWith("/api/room"))return route.fulfill({contentType:"application/json",body:JSON.stringify(publicRoom(r,user(0)))});
    return route.fulfill({contentType:"text/html",body:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body><div id="root"></div></body></html>'});
   });
   async function mount(){
    await page.goto("https://poker.test/poker");await page.addStyleTag({content:readFileSync("app/globals.css","utf8")});await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.getByRole("region",{name:"Poker table"}).waitFor();
   }
   await mount();await page.getByRole("button",{name:"Ready",exact:true}).click();
   await page.getByRole("button",{name:"Unready",exact:true}).waitFor();
   assert.ok(r.seats[0]!.ready);const expiry=r.readyDeadline;
   assert.equal(await page.getByRole("button",{name:"Cash out $200",exact:true}).isEnabled(),true);
   await page.getByRole("button",{name:"Unready",exact:true}).click();
   await page.getByRole("button",{name:"Ready",exact:true}).waitFor();
   assert.equal(r.seats[0]!.ready,false);assert.equal(r.readyDeadline,expiry);
   await page.getByRole("button",{name:"Ready",exact:true}).click();
   await page.getByRole("button",{name:"Unready",exact:true}).waitFor();
   await page.getByRole("button",{name:"Cash out $200",exact:true}).click();
   await page.getByRole("heading",{name:"Good to see you, Player 0."}).waitFor();
   await page.waitForFunction(()=>document.querySelector(".action-bar")?.textContent?.includes("Pull up a chair."));
   assert.equal(r.members[0].wallet,100000);assert.equal(r.seats[0],null);
   applyAction(r,user(0),{type:"join",seat:0,buyIn:20000},Date.now());
   for(let i=0;i<2;i++)applyAction(r,user(i),{type:"ready"},Date.now());r.version++;
   await mount();assert.equal(await page.getByRole("button",{name:"Unready",exact:true}).count(),0);
   assert.equal(await page.getByRole("button",{name:/^Cash out/}).isDisabled(),true);
   act(r,r.seats[r.turn!]!.userId,{type:"fold"},Date.now());r.version++;assertRoom(r);
   await mount();assert.equal(await page.getByRole("button",{name:/^Cash out/}).isEnabled(),true);
   tick(r,Date.now()+9000);r.version++;await mount();
   assert.equal(r.handNumber,1);assert.ok(r.seats.filter(Boolean).every(s=>!s!.ready));
   await page.getByRole("button",{name:"Ready",exact:true}).click();await page.getByRole("button",{name:"Unready",exact:true}).waitFor();
   assert.equal(r.handNumber,1);assert.equal(r.seats[1]!.ready,false);assertRoom(r);
   assert.deepEqual(errors,[]);assert.deepEqual(posts,["ready","unready","ready","leave","ready"]);
   await page.close();
  }
 }finally{await browser.close();}
});
