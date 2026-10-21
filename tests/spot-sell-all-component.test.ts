import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {freshRoom,register,assertRoom} from "../lib/poker";
import {publicRoom} from "../lib/public";
import {spot} from "../lib/finance";
import {sellAllSpot} from "../lib/spot-sell-all";
const require=createRequire(import.meta.url),{build}=require("esbuild");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/opt/hako/lib/node_modules/playwright");
test("portfolio Sell all works in desktop/mobile light/dark using exact-unit settlement",async()=>{
 const bundle=await build({entryPoints:["tests/fixtures/spot-sell-all-live.tsx"],bundle:true,write:false,loader:{".module.css":"empty"},jsx:"automatic",plugins:[{name:"chart-only",setup(b:any){
 b.onResolve({filter:/^\.\/cached-chart$/},()=>({path:"chart",namespace:"stub"}));
 b.onLoad({filter:/.*/,namespace:"stub"},()=>({contents:"export default function Chart(){return null}",loader:"js"}));
 }}]});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||"/opt/hako/bin/google-chrome"});
 try{for(const width of [390,1440])for(const colorScheme of ["light","dark"]){
 const who={id:"fixture",name:"Fixture",email:"fixture@example.test",admin:false},r=freshRoom();register(r,who);
 r.quotes={BTC:{micro:82_700_000_000,at:Date.now()}};spot(r,who,"BTC","buy",100);r.quotes!.BTC!.micro=84_500_000_000;
 const page=await browser.newPage({viewport:{width,height:1000},colorScheme});
 await page.route("https://spot.test/**",async(route:any)=>{
 const url=route.request().url();
 if(url.endsWith("/room"))return route.fulfill({json:publicRoom(r,who)});
 if(url.endsWith("/api/finance")){
 const input=route.request().postDataJSON();assert.equal(input.type,"sell-all-spot");assert.equal(input.symbol,"BTC");assert.ok(input.requestId&&input.requestAt);
 sellAllSpot(r,who,input.symbol);assertRoom(r);return route.fulfill({json:publicRoom(r,who)});
 }
 return route.fulfill({contentType:"text/html",body:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'});
 });
 await page.goto("https://spot.test");await page.addStyleTag({path:"app/globals.css"});await page.addScriptTag({content:bundle.outputFiles[0].text});
 const button=page.getByRole("button",{name:"Sell all BTC",exact:true});await button.waitFor();await button.scrollIntoViewIfNeeded();assert.ok(await button.isEnabled());await button.click();await page.getByText("No spot holdings yet.",{exact:true}).waitFor();assert.equal(r.members[0].wallet,100002);assert.equal(r.members[0].holdings!.length,0);
 await page.close();
 }}finally{await browser.close();}
});
