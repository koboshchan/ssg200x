import {test} from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {runInNewContext} from "node:vm";

// Diagnostic contract harness, not browser acceptance. Model the installed
// v10 loader's clone/reset/append and scroll sign so wrapper regressions fail.
test("engine preserves panned viewport across precision changes and bounds both live datasets",async()=>{
 let loader:any,data:any[]=[],offset=4,precisionResets=0,resets=0;
 const indicators:any[]=[];
 const chart:any={
  setStyles(){},setDecimalFold(){},setPeriod(){},setOffsetRightDistance(){},
  setSymbol(){precisionResets++;if(loader)this.resetData();},
  setDataLoader(value:any){loader=value;this.resetData();},
  resetData(){
   resets++;offset=4;
   loader?.getBars({type:"init",callback:(rows:any[])=>{data=rows;}});
   loader?.subscribeBar({callback:(row:any)=>{
    const last=data.at(-1);
    if(last?.timestamp===row.timestamp)data[data.length-1]=row;
    else data.push(row);
   }});
  },
  getVisibleRange(){return {to:Math.min(data.length,Math.floor(data.length+offset)),realTo:data.length+offset};},
  convertToPixel({timestamp}:any){
   const i=data.findIndex(row=>row.timestamp===timestamp);
   return {x:800-(data.length+offset-i)*10};
  },
  scrollByDistance(distance:number){offset-=distance/10;},
  getOverlays(){return [];},createOverlay(){return "overlay";},removeOverlay(){},
  getIndicators(){return indicators;},createIndicator(){},removeIndicator(){},
 };
 const output=await build({entryPoints:["app/market-chart-engine.ts"],bundle:true,write:false,format:"cjs",platform:"node",
  plugins:[{name:"chart-double",setup(b){b.onResolve({filter:/^klinecharts$/},()=>({path:"chart-double",namespace:"test"}));b.onLoad({filter:/.*/,namespace:"test"},()=>({contents:"export const init=()=>globalThis.__chart;export const dispose=()=>{};export const registerOverlay=()=>{};"}));}}]});
 const context:any={module:{exports:{}},exports:{},__chart:chart,getComputedStyle:()=>({getPropertyValue:()=>"#123456"}),
  matchMedia:()=>({addEventListener(){},removeEventListener(){}}),queueMicrotask};
 runInNewContext(output.outputFiles[0].text,context);
 const engine=context.module.exports.createMarketChart({},{
  symbol:"TEST",period:{type:"minute",span:1},storeKey:null,initialPrice:1.01,
  onTool(){},onCount(){},onSelected(){},onIndicators(){},
 });
 const row=(i:number,close=1.01)=>({time:i*60000,open:close,high:close,low:close,close,volume:7});
 engine.replace(Array.from({length:301},(_,i)=>row(i)));
 offset=-20.25;
 const anchor=data[280].timestamp;
 const oldX=chart.convertToPixel({timestamp:anchor}).x;
 const before=precisionResets,resetCount=resets;
 engine.update(row(300,.99));
 assert.equal(precisionResets,before+1);
 assert.equal(resets,resetCount+1,"setSymbol resets once, never reset twice");
 assert.equal(chart.convertToPixel({timestamp:anchor}).x,oldX,"panned fractional viewport survives precision boundary");
 assert.equal(data.length,301);
 engine.update(row(301,.99));
 assert.equal(data.length,301,"native loader is trimmed, not just wrapper rows");
 assert.equal(data[0].timestamp,60000);
 assert.equal(chart.convertToPixel({timestamp:anchor}).x,oldX,"pan survives bounded rollover");
 const snapshot=Array.from({length:301},(_,j)=>row(j+1,j+1>=300?.99:1.01));
 engine.replace(snapshot);
 assert.equal(data.length,301);
 assert.equal(data.at(-1).timestamp,301*60000);
 // Loader owns clones. Same-bucket replacements cannot mutate wrapper storage.
 data.at(-1).close=2;
 engine.replace(snapshot);
 assert.equal(data.at(-1).close,2,"identical source snapshots remain no-ops");
 engine.update(row(301,.99));
 assert.equal(data.at(-1).close,.99);
 engine.destroy();
});
