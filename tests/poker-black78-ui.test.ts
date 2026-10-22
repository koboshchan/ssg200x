import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {showdown} from "../lib/poker";
import {publicRoom} from "../lib/public";
import {pokerShowdown,pokerUser} from "./fixtures/poker-black78";
const require=createRequire(import.meta.url);
const {build}=require("esbuild");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/opt/hako/lib/node_modules/playwright");

test("actual poker UI displays server Black 78 payout/history, tied split labels, and hole-only/folding rule",async()=>{
 const bundle=await build({entryPoints:["tests/fixtures/poker-black78-ui.tsx"],bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",loader:{".module.css":"empty",".css":"empty"},plugins:[{name:"poker-ui-boundaries",setup(b:any){
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
  const cases=[
   {kind:"special",r:pokerShowdown([100,100],[["7s","8c"],["Th","3h"]]),labels:["Black 78"]},
   {kind:"tie",r:pokerShowdown([101,101,101],[["7s","8s"],["7c","8c"],["Th","3h"]],[2]),labels:["Black 78","Black 78"]},
   {kind:"normal",r:pokerShowdown([100,100],[["7h","8d"],["Th","3h"]]),labels:["Royal Flush"]},
  ];
  const proof=[];
  for(const {kind,r,labels} of cases){
   showdown(r,Date.now());const state=publicRoom(r,pokerUser(0));
   const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];
   page.on("pageerror",(error:Error)=>errors.push(error.message));
   await page.route("http://poker.test/**",async(route:any)=>route.fulfill(route.request().url().endsWith("/api/room")?{contentType:"application/json",body:JSON.stringify(state)}:{contentType:"text/html",body:'<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>'}));
   await page.goto("http://poker.test/poker");await page.addStyleTag({content:readFileSync("app/globals.css","utf8")});
   await page.addScriptTag({content:bundle.outputFiles[0].text});
   await page.getByRole("region",{name:"Poker table"}).waitFor();
   const rendered=await page.locator(".rail .winner-note span").allTextContents();
   assert.equal(rendered.length,labels.length);
   labels.forEach((label,i)=>label==="Black 78"?assert.equal(rendered[i],label):assert.match(rendered[i],/Royal Flush/));
   assert.ok((await page.getByRole("list",{name:"Hand history"}).innerText()).includes(labels[0]));
   await page.getByText("House rules",{exact:true}).click();
   const rule=await page.locator(".rules").innerText();
   assert.match(rule,/Black 78:.*two hole cards.*showdown.*royal flush/);
   assert.match(rule,/Two Black 78 hands split eligible pots/);assert.match(rule,/Folding still forfeits/);
   assert.deepEqual(errors,[]);
   proof.push({kind,payoutLabels:rendered,errors});
   if(process.env.POKER_QA_EVIDENCE){mkdirSync(process.env.POKER_QA_EVIDENCE,{recursive:true});await page.screenshot({path:resolve(process.env.POKER_QA_EVIDENCE,kind+".png"),fullPage:true});}
   await page.close();
  }
  if(process.env.POKER_QA_EVIDENCE)writeFileSync(resolve(process.env.POKER_QA_EVIDENCE,"browser.json"),JSON.stringify({actualComponent:"app/room-client.tsx RoomView/Game",mockedBoundaries:["Clerk","Next navigation","live connection","GET /api/room"],serverGeneratedPayouts:true,cases:proof},null,2));
 }finally{await browser.close();}
});
