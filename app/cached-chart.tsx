"use client";
import {useEffect,useRef,useState} from "react";
import {useUser} from "@clerk/nextjs";
import {chartStorageKey,INDICATORS,type ChartIndicator} from "@/lib/chart-preferences";
import type {ChartControls,ChartTool} from "./market-chart-engine";
import styles from "./market-chart.module.css";
import {mergeChartCandles,tickCandle,type LiveQuote} from "@/lib/live-candle";
import {chartCache} from "@/lib/client-market-cache";
import {useLive} from "./live-provider";
import {chartDisplayQuote,type ChartDisplayContext,type ChartDisplayQuote} from "@/lib/chart-display-policy";
import type {Symbol} from "@/lib/market-shared";
const intervals={"1m":60000,"5m":300000,"15m":900000,"1h":3600000,"6h":21600000,"1d":86400000};
type Row={time:number;open:number;high:number;low:number;close:number;volume?:number};
export default function CachedChart({symbol,quote,displayContext}:{symbol:Symbol;quote?:ChartDisplayQuote;displayContext:ChartDisplayContext}){
 const {connection,subscribe,emit}=useLive(),node=useRef<HTMLDivElement>(null),[interval,setIntervalName]=useState<keyof typeof intervals>("1h"),[status,setStatus]=useState("Loading cached candles");
 const [fixture,setFixture]=useState(false);
 const {user,isLoaded}=useUser(),controls=useRef<ChartControls|null>(null);
 const [tool,setTool]=useState<ChartTool|null>(null),[drawingCount,setDrawingCount]=useState(0),[selected,setSelected]=useState(false),[indicators,setIndicators]=useState<ChartIndicator[]>([]),[ready,setReady]=useState(false);
 const storeKey=chartStorageKey(isLoaded?user?.id:null,symbol);
 const selection=useRef({symbol,granularity:interval});selection.current={symbol,granularity:interval};
 const display=useRef(displayContext);display.current=displayContext;
 const latest=useRef(quote),push=useRef<((q:LiveQuote)=>void)|undefined>(undefined);latest.current=quote;
 useEffect(()=>{if(connection==="connected")emit("candles:subscribe",selection.current);},[connection,emit]);
 useEffect(()=>{if(quote)push.current?.(quote);},[quote?.micro,quote?.at,quote?.source,quote?.cryptoGeneration,displayContext]);
 useEffect(()=>{
 let unsubscribe:(()=>void)|undefined;
 let closed=false,chart:ChartControls|undefined;setFixture(false);setStatus("Loading chart");push.current=undefined;setReady(false);setTool(null);setSelected(false);setDrawingCount(0);setIndicators([]);const controller=new AbortController();
 const width=intervals[interval],cacheKey=symbol+":"+interval;
 async function start(){
 const {createMarketChart}=await import("./market-chart-engine");if(closed||!node.current)return;
 const period={type:interval.endsWith("m")?"minute":interval.endsWith("h")?"hour":"day",span:parseInt(interval)} as const;
 chart=createMarketChart(node.current,{symbol,period,storeKey,initialPrice:latest.current?latest.current.micro/1e6:chartCache.get(cacheKey)?.rows.at(-1)?.close,onTool:setTool,onCount:setDrawingCount,onSelected:setSelected,onIndicators:setIndicators});
 controls.current=chart;setReady(true);
 const fixtureResponse=await fetch("/api/qa-chart-fixture?"+new URLSearchParams({symbol,granularity:interval}),{signal:controller.signal,cache:"no-store"});
 if(closed)return;
 if(fixtureResponse.status!==404){
  if(!fixtureResponse.ok)throw new Error("QA fixture configuration unavailable");
  const data=await fixtureResponse.json();
  if(data.fixtureDemoOnly!==true||data.liveDisabled!==true||!Array.isArray(data.candles))throw new Error("Invalid QA fixture response");
  setFixture(true);chart.replace(data.candles);setStatus("Deterministic fixture candles. LIVE disabled. Not real-feed acceptance");
  return;
 }

 const live=new Map<number,Row>();let lastAt=-1;
 push.current=q=>{if(closed||q.at<lastAt||!chartDisplayQuote(q,display.current,Date.now()))return;const time=Math.floor(q.at/width)*width;const row=tickCandle(live.get(time)??chartCache.get(cacheKey)?.rows.find(row=>row.time===time),q,width);if(!row)return;lastAt=q.at;live.set(time,row);chartCache.put(cacheKey,[row],chartCache.get(cacheKey)?.checkedAt??0);chart?.update(row);};
 let receivedSnapshot=false;
 function render(history:Row[],checkedAt=Date.now()){
  if(closed)return;
  const rows=mergeChartCandles(chartCache.put(cacheKey,history,checkedAt).rows,live);
  for(const row of rows)if(live.has(row.time))live.set(row.time,row);
  const oldest=rows[0]?.time??0;for(const time of live.keys())if(time<oldest)live.delete(time);
  chart?.replace(rows);if(latest.current)push.current?.(latest.current);
 }
 const cached=chartCache.get(cacheKey);if(cached){render(cached.rows,cached.checkedAt);setStatus("Cached history, updating live");}
 unsubscribe=subscribe("candles:state",snapshot=>{
  if(snapshot?.symbol!==symbol||snapshot.granularity!==interval||!Array.isArray(snapshot.candles))return;
  receivedSnapshot=true;render(snapshot.candles);
  setStatus(snapshot.candles.length?"Cached history, updating live":"No cached history yet. Live candles remain available");
 });
 emit("candles:subscribe",{symbol,granularity:interval});
 if(latest.current)push.current?.(latest.current);
 async function load(){try{
 const range=chartCache.range(cacheKey,width);if(!range)return;const {from,to}=range;
 const p=new URLSearchParams({symbol,granularity:interval,from:String(from),to:String(to)}),response=await fetch("/api/candles?"+p,{signal:controller.signal}),data=await response.json();
 if(!response.ok)throw new Error(data.error||"Chart unavailable");if(closed)return;
 if(receivedSnapshot)return;
 render(data.candles as Row[]);
 setStatus(data.candles.length?"Stored candles, updating live":"No stored candles yet. Live observations appear as they arrive");
 }catch(e){if(!closed){setStatus(e instanceof Error?e.message:"Chart unavailable")}}}
 await load();
 }
 start().catch(()=>{if(!closed)setStatus("Could not load chart");});return()=>{closed=true;controller.abort();unsubscribe?.();emit("candles:subscribe",null);push.current=undefined;controls.current=null;chart?.destroy();};
 },[symbol,interval,subscribe,emit,storeKey]);
 return <div className="cached-chart">
  {fixture?<p role="note"><strong>DEMO FIXTURE — NOT LIVE</strong> · LIVE disabled. Not market history or real-feed acceptance.</p>:null}
  <div className="symbol-tabs" role="group" aria-label="Chart interval">{Object.keys(intervals).map(g=><button key={g} type="button" aria-pressed={g===interval} onClick={()=>setIntervalName(g as keyof typeof intervals)}>{g}</button>)}</div>
  <div className={styles.tools} role="group" aria-label="Chart drawing tools">
   {(["trend","hline","rect","fib"] as const).map(t=><button key={t} type="button" disabled={!ready} aria-pressed={tool===t} onClick={()=>controls.current?.setTool(tool===t?null:t)}>{{trend:"Trend",hline:"Horizontal",rect:"Rectangle",fib:"Fibonacci"}[t]}</button>)}
   <button type="button" disabled={!tool} onClick={()=>controls.current?.setTool(null)}>Cancel</button>
   <button type="button" disabled={!selected} onClick={()=>controls.current?.deleteSelected()}>Delete selected</button>
   <button type="button" disabled={!drawingCount&&!tool} onClick={()=>controls.current?.clear()}>Clear drawings</button>
  </div>
  <div className={styles.indicators} role="group" aria-label="Chart indicators">{INDICATORS.map(name=><button key={name} type="button" disabled={!ready} aria-pressed={indicators.includes(name)} onClick={()=>controls.current?.setIndicators(indicators.includes(name)?indicators.filter(i=>i!==name):[...indicators,name])}>{name}</button>)}</div>
  <div className={"chart-shell "+styles.canvas} ref={node} tabIndex={0} role="region" aria-label={symbol+" price chart"} onKeyDown={e=>{if(e.key==="Escape"){controls.current?.setTool(null);e.preventDefault();}else if(e.key==="Delete"||e.key==="Backspace"){controls.current?.deleteSelected();e.preventDefault();}}}/>
  <p className="market-note" role="status">{!fixture&&connection==="disconnected"?"Disconnected. Prices are stale. ":""}{fixture?"Deterministic fixture candles. Not market history or real-feed acceptance":status}. {tool?"Tap the chart to place drawing anchors. Escape or Cancel stops drawing. ":""}{drawingCount} drawing{drawingCount===1?"":"s"}. {user?"Drawings and indicators saved on this device.":"Sign in to save drawings and indicators."} {indicators.includes("VOL")?"Quote-only candles have no reported trading volume. ":""}<a href="https://klinecharts.com/" target="_blank" rel="noopener noreferrer">KLineChart</a></p>
 </div>;
}
