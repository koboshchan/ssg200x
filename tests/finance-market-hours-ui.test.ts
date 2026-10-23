import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {build} from "esbuild";
import {freshRoom,register} from "./helpers/crypto-room";
import {publicRoom} from "../lib/public";
import {mergeMarket} from "../lib/room-sync";
// @ts-expect-error Native JS runtime.
import {marketPayload} from "../runtime/market-payload.mjs";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/home/kit/out/cal-browser-evidence/node_modules/playwright");
function fixture(kind:"stock"|"fx",now:number){
 const r=freshRoom(),who={id:"ui-hours",name:"UI",email:"ui@test",admin:false};register(r,who);
 const symbol=kind==="stock"?"AAPL":"EUR/USD";
 r.marketSymbols={crypto:[],stocks:kind==="stock"?[symbol]:[],forex:kind==="fx"?[symbol]:[],delisted:[],revision:1};
 const full=publicRoom(r,who);full.serverNow=now;
 full.positions=[{id:"position",symbol,side:"long",leverage:2,margin:10000,entry:1200000,liquidation:600000,pnl:0,opened:now-86400000,openingFee:0} as any];
 return {r,who,full,symbol};
}
test("display-only FX retention survives native payload and client merge, never becomes an execution quote",()=>{
 const now=Date.parse("2026-11-01T15:00:00Z"),{r,who,full}=fixture("fx",now);
 r.forexLastQuotes={"EUR/USD":{micro:1234567,at:now-86400000,source:"oanda",quoteCurrency:"USD"}};
 r.forexQuotes={};
 const payload=marketPayload(r,who.id,now),merged=mergeMarket(full,payload)!;
 assert.deepEqual(merged.forexLastQuotes,r.forexLastQuotes);
 assert.deepEqual(merged.forexQuotes,{});assert.deepEqual(r.forexQuotes,{});
 assert.equal((payload.forexLastQuotes["EUR/USD"] as any).usdMicro,undefined);
});
test("desktop/mobile stock and FX closure banners retain prices and disable open, full/partial closes and bulk close",async()=>{
 const out=await build({stdin:{contents:`
 import React from "react";import {createRoot} from "react-dom/client";import {Markets} from "./app/finance-client";
 const root=createRoot(document.getElementById("root"));let n=0;window.calls=[];
 window.mount=room=>root.render(<Markets key={++n} room={room} busy={false} post={async(...args)=>{window.calls.push(args)}}/>);
 `,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",loader:{".css":"empty"},plugins:[{name:"isolated-ui-dependencies",setup(b){
 b.onResolve({filter:/\.css$/},()=>({path:"styles",namespace:"css-mock"}));
 b.onLoad({filter:/.*/,namespace:"css-mock"},()=>({contents:"export default {}",loader:"js"}));
 b.onResolve({filter:/use-features$|live-provider$|cached-chart$/},args=>({path:args.path,namespace:"ui-mock"}));
 b.onLoad({filter:/.*/,namespace:"ui-mock"},args=>({resolveDir:process.cwd(),loader:"tsx",contents:args.path.endsWith("use-features")?'export const useFeatures=()=>({features:{stocks:true,forex:true,cryptoSpot:true,cryptoPerps:true}});':args.path.endsWith("live-provider")?'const emit=()=>{};export const useLive=()=>({connection:"connected",emit});':'import React from "react";export default function Chart({quote}){return <div data-testid="chart" data-micro={quote?.micro} data-at={quote?.at}/>;}'}));
 }}]});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||"/opt/hako/bin/chrome",args:["--no-sandbox"]});
 try{
 for(const width of [1280,375]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors:string[]=[];page.on("pageerror",(e:Error)=>errors.push(e.message));
 await page.setContent('<!doctype html><meta charset="utf-8"><div id="root"></div>');await page.addScriptTag({content:out.outputFiles[0].text});
 for(const kind of ["stock","fx"] as const){
 const now=Date.parse("2026-11-01T15:00:00Z"),{full,symbol}=fixture(kind,now),at=now-86400000;
 full.quotes=kind==="stock"?{AAPL:{micro:200000000,at}}:{};
 if(kind==="stock"){
 full.stockExecution={AAPL:{executable:false,reason:"stale_or_invalid_tick",validUntil:0,marketHours:{calendarAvailable:true,closed:true,nextOpen:Date.parse("2026-11-02T14:30:00Z"),sessionOpen:null,sessionClose:null,validUntil:now+60000,timeZone:"America/New_York"}}};
 full.holdings=[{symbol,units:100000000,cost:20000,value:20000}];
 }else{
 full.forexLastQuotes={[symbol]:{micro:1234567,at,source:"oanda",quoteCurrency:"USD"}};
 full.forexQuotes={};full.forexExecution={[symbol]:{executable:false,reason:"market_closed",validUntil:0}};
 full.forexStatus={mode:"live",stream:"down",marketOpen:false,message:"Closed"};
 }
 await page.evaluate((room:typeof full)=>(window as any).mount(room),full);
 await page.getByText("Last close price · display only",{exact:true}).waitFor();
 assert.match(await page.locator(".feature-notice").first().innerText(),/Market closed, opens .* ET/);
 assert.equal(await page.getByRole("button",{name:"Buy "+symbol,exact:true}).isDisabled(),true);
 assert.equal(await page.getByRole("button",{name:"Close",exact:true}).isDisabled(),true);
 assert.equal(await page.getByRole("button",{name:"Partial close",exact:true}).isDisabled(),true);
 assert.equal(await page.getByRole("button",{name:"Add margin",exact:true}).isDisabled(),true);
 assert.equal(await page.getByLabel("Close positions",{exact:true}).getAttribute("aria-disabled"),"true");
 if(kind==="stock")assert.equal(await page.getByRole("button",{name:"Sell all AAPL",exact:true}).isDisabled(),true);
 else{
 assert.equal(await page.locator(".price strong").innerText(),"1.23457 USD");
 assert.equal(await page.getByTestId("chart").getAttribute("data-at"),String(at));
 assert.equal(await page.getByTestId("chart").getAttribute("data-micro"),"1234567");
 // Healthy execution metadata alone must not open orders on a closed weekend.
 full.forexExecution[symbol]={executable:true,reason:"healthy_stream_current_generation_price",validUntil:now+60000};
 full.forexQuotes={[symbol]:{...full.forexLastQuotes[symbol],usdMicro:1234567} as any};
 await page.evaluate((room:typeof full)=>(window as any).mount(room),full);
 assert.equal(await page.getByRole("button",{name:"Buy "+symbol,exact:true}).isDisabled(),true);
 // After opening, a retained-only rate still cannot authorize an order.
 full.serverNow=Date.parse("2026-11-02T15:00:00Z");full.forexQuotes={};
 full.forexExecution[symbol]={executable:true,reason:"healthy_stream_current_generation_price",validUntil:full.serverNow+60000};
 await page.evaluate((room:typeof full)=>(window as any).mount(room),full);
 await page.getByText("View only.",{exact:true}).waitFor();
 assert.equal(await page.getByRole("button",{name:"Buy "+symbol,exact:true}).isDisabled(),true);
 assert.equal(await page.getByRole("button",{name:"Close",exact:true}).isDisabled(),true);
 // Unchanged but current-stream real rate remains executable with healthy heartbeat.
 full.forexQuotes={[symbol]:{...full.forexLastQuotes[symbol],usdMicro:1234567} as any};
 await page.evaluate((room:typeof full)=>(window as any).mount(room),full);
 await page.getByText("Live forex.",{exact:true}).waitFor();
 assert.equal(await page.getByRole("button",{name:"Buy "+symbol,exact:true}).isDisabled(),false);
 }
 assert.deepEqual(await page.evaluate(()=>(window as any).calls),[]);
 }
 assert.deepEqual(errors,[]);await page.close();
 }
 }finally{await browser.close();}
});
