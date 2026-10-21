import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {resolve} from "node:path";
const require=createRequire(import.meta.url);
const {chromium}=require("/home/kit/out/cal-browser-evidence/node_modules/playwright");
const {build}=require("esbuild");
test("mounted Wallet keeps independent requests, cancels one, expires codes, and shares the phrase picker",async()=>{
 const bundle=await build({entryPoints:["tests/fixtures/wallet-live.tsx"],bundle:true,define:{"process.env.NEXT_PUBLIC_SSG_RELEASE":'"development"'},outfile:"wallet-fixture.js",write:false,format:"iife",platform:"browser",jsx:"automatic",loader:{".module.css":"empty"},plugins:[{name:"wallet-fixtures",setup(b:any){
 b.onResolve({filter:/^@clerk\/nextjs$/},()=>({path:"auth",namespace:"fixture"}));
 b.onLoad({filter:/auth/,namespace:"fixture"},()=>({contents:'export function useAuth(){return {getToken:async()=>"test"}}',loader:"js"}));
 b.onResolve({filter:/^next\/navigation$/},()=>({path:"nav",namespace:"fixture"}));
 b.onLoad({filter:/nav/,namespace:"fixture"},()=>({contents:'export function usePathname(){return "/wallet"}',loader:"js"}));
 b.onResolve({filter:/^socket.io-client$/},()=>({path:resolve("tests/fixtures/wallet-socket.ts")}));
 }}]});
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{channel:"chromium"})});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors:string[]=[],posts:any[]=[];
 page.on("pageerror",(error:Error)=>errors.push(error.message));
 await page.clock.install({time:new Date("2026-10-20T20:00:00Z")});
 let requests=[{id:"first",code:"abandon ability",amount:1250,note:"First",expiresAt:Date.parse("2026-10-20T20:10:00Z")}];
 await page.route("https://wallet.test/**",async(route:any)=>{
 const request=route.request(),url=new URL(request.url());
 if(!url.pathname.startsWith("/api/"))return route.fulfill({contentType:"text/html",body:'<!doctype html><meta charset="utf-8"><div id="root"></div>'});
 const body=request.postDataJSON();let value:any={transfers:[]};
 if(url.searchParams.has("active"))value={codes:requests};
 if(body){posts.push(body);if(body.action==="code"){value={id:"second",code:"able about",amount:Math.round(Number(body.amount)*100),note:body.note,expiresAt:Date.parse("2026-10-20T20:10:00Z")};requests=[value,...requests];}else if(body.action==="cancel"){requests=requests.filter(item=>item.id!==body.id);value={cancelled:true};}}
 await route.fulfill({contentType:"application/json",body:JSON.stringify(value)});
 });
 await page.goto("https://wallet.test");
 await page.addStyleTag({content:bundle.outputFiles.find((f:any)=>f.path.endsWith(".css"))?.text??""});
 await page.addScriptTag({content:bundle.outputFiles.find((f:any)=>!f.path.endsWith(".css")).text});
 await page.waitForFunction(()=>Boolean((window as any).walletSocket));
 await page.evaluate(()=>(window as any).walletSocket("room:state",{me:{wallet:10000,admin:false},transferHistoryKeys:{mine:"a",all:"a"}}));
 await page.getByRole("article",{name:"abandon ability",exact:true}).waitFor();
 await page.getByLabel("Amount in dollars",{exact:true}).fill("25.50");
 await page.getByLabel("Note (optional)",{exact:true}).fill("Second");
 await page.getByRole("button",{name:"Generate receive code"}).click();
 const second=page.getByRole("article",{name:"able about",exact:true});await second.waitFor();
 assert.match(await second.innerText(),/\$25.50/);assert.match(await second.innerText(),/Second/);
 assert.equal(await page.getByRole("article").count(),2);
 assert.equal(await page.getByRole("button",{name:"Generate receive code"}).isDisabled(),true);
 await page.clock.runFor(2000);assert.equal(await page.getByRole("button",{name:"Generate receive code"}).isEnabled(),true);
 await second.getByRole("button",{name:"Cancel code"}).click();await second.waitFor({state:"detached"});
 assert.equal(await page.getByRole("article").count(),1);assert.deepEqual(posts.filter(item=>item.action==="cancel"),[{action:"cancel",id:"second"}]);
 const field=page.getByRole("combobox",{name:"Recipient’s two-word code"});await field.fill("he");
 const options=page.getByRole("option");assert.deepEqual(await options.allTextContents(),["head","health","heart","heavy","hedgehog","height","hello","helmet","help","hen","hero"]);
 await field.press("ArrowDown");await field.press("Enter");assert.equal(await field.inputValue(),"health ");
 await field.fill("  abandon ability able about  ");assert.equal(await field.inputValue(),"  abandon ability able about  ");
 await page.clock.runFor(600000);await page.getByText("No active receive codes.",{exact:true}).waitFor();assert.equal(await page.getByRole("article").count(),0);
 assert.equal(await page.getByRole("combobox").count(),1);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
