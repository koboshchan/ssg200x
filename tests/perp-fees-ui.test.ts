import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {freshRoom,register} from '../lib/poker';
import {setPerpFee} from '../lib/admin';
import {openPosition,closePosition} from '../lib/finance';
import {publicRoom} from '../lib/public';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/home/kit/out/cal-browser-evidence/node_modules/playwright'),{build}=require('esbuild');
test('hydrated real market previews opening charge before confirmation, submits disclosed rate and shows actual fees/net history',async()=>{
 const who={id:'ui',name:'UI',email:'ui@test',admin:true},r=freshRoom();register(r,who);r.quotes={BTC:{micro:100000000,at:Date.now()}};setPerpFee(r,who,0.05);
 openPosition(r,who,'BTC','long',10000,5,'closed',Date.now());closePosition(r,who,'closed',Date.now());openPosition(r,who,'BTC','short',10000,5,'open',Date.now());
 const out=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {Markets} from './app/finance-client';createRoot(document.getElementById('root')).render(<Markets room={${JSON.stringify(publicRoom(r,who))}} busy={false} post={async(path,body)=>{window.submitted={path,body}}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'isolated-chart-and-css',setup(b:any){
 b.onResolve({filter:/^\.\/live-provider$/},()=>({path:"live",namespace:"live-stub"}));
 b.onLoad({filter:/.*/,namespace:"live-stub"},()=>({contents:'export function useLive(){return {connection:"connected",emit(){}}}',loader:"js"}));
 b.onResolve({filter:/cached-chart$/},()=>({path:'chart',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export default function Chart(){return null}',loader:'js'}));b.onLoad({filter:/\.css$/},()=>({contents:'export default {}',loader:'js'}));}}]});
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});try{
 for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:900}});await page.route('https://fees.test/**',async(route:any)=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><div id="root"></div>'}));
 await page.goto('https://fees.test');await page.addStyleTag({content:readFileSync('app/globals.css','utf8')});await page.addScriptTag({content:out.outputFiles[0].text});
 await page.getByRole('button',{name:'Perps',exact:true}).click();await page.getByText(/Estimated opening fee \$0.25/).waitFor();
 assert.equal(await page.getByRole('columnheader',{name:'Net realized P/L'}).count(),1);assert.equal(await page.getByText('$0.25 / $0.25',{exact:true}).count(),1);assert.equal(await page.getByText('-$0.50',{exact:true}).count(),1);
 assert.equal(await page.getByText('Opening fee $0.25 · closing rate 0.05%',{exact:true}).count(),1);
 await page.getByRole('button',{name:'Open long · 5x',exact:true}).click();
 const posted=await page.evaluate(()=>(window as any).submitted);assert.equal(posted.body.expectedFeePpm,500);assert.equal(posted.body.margin,10000);
 await page.screenshot({path:`/home/kit/fee-history-${width}.png`,fullPage:true});await page.close();
 }
 }finally{await browser.close();}
 const source=readFileSync('app/finance-client.tsx','utf8'),route=readFileSync('app/api/finance/route.ts','utf8');assert.ok(source.includes('expectedFeePpm:room.perpFeePpm'));assert.ok(route.includes('(input.expectedFeePpm??0)===(r.perpFeePpm??DEFAULT_PERP_FEE_PPM)'));
});
