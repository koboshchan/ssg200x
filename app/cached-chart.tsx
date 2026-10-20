"use client";
import {useEffect,useRef,useState} from "react";
import {mergeChartCandles,tickCandle,type LiveQuote} from "@/lib/live-candle";
import {useLive} from "./live-provider";
import type {Symbol} from "@/lib/market-shared";
const intervals={"1m":60000,"5m":300000,"15m":900000,"1h":3600000,"6h":21600000,"1d":86400000};
type Row={time:number;open:number;high:number;low:number;close:number};
export default function CachedChart({symbol,quote}:{symbol:Symbol;quote?:LiveQuote}){
 const {connection,subscribe,emit}=useLive(),node=useRef<HTMLDivElement>(null),[interval,setIntervalName]=useState<keyof typeof intervals>("1h"),[status,setStatus]=useState("Loading cached candles");
 const selection=useRef({symbol,granularity:interval});selection.current={symbol,granularity:interval};
 const latest=useRef(quote),push=useRef<((q:LiveQuote)=>void)|undefined>(undefined);latest.current=quote;
 useEffect(()=>{if(connection==="connected")emit("candles:subscribe",selection.current);},[connection,emit]);
 useEffect(()=>{if(quote)push.current?.(quote);},[quote?.micro,quote?.at]);
 useEffect(()=>{
 let unsubscribe:(()=>void)|undefined;
 let closed=false,chart:import("lightweight-charts").IChartApi|undefined;const controller=new AbortController();
 const width=intervals[interval];
 async function start(){
 const {createChart,CandlestickSeries,ColorType}=await import("lightweight-charts");if(closed||!node.current)return;
 const dark=matchMedia("(prefers-color-scheme: dark)").matches;
 chart=createChart(node.current,{autoSize:true,layout:{background:{type:ColorType.Solid,color:dark?"#1c1c1e":"#fff"},textColor:dark?"#eee":"#333",attributionLogo:true},grid:{vertLines:{color:dark?"#303033":"#f0f0f0"},horzLines:{color:dark?"#303033":"#f0f0f0"}},timeScale:{timeVisible:true}});
 const series=chart.addSeries(CandlestickSeries);
 const live=new Map<number,Row>();let lastAt=-1;
 const point=(c:Row)=>({...c,time:Math.floor(c.time/1000) as import("lightweight-charts").UTCTimestamp});
 push.current=q=>{if(closed||q.at<lastAt||Date.now()-q.at>10000||q.at>Date.now()+1000)return;const time=Math.floor(q.at/width)*width;const row=tickCandle(live.get(time),q,width);if(!row)return;lastAt=q.at;live.set(time,row);series.update(point(row));};
 let fitted=false,receivedSnapshot=false;
 function render(history:Row[]){
  if(closed)return;
  const rows=mergeChartCandles(history,live);
  for(const row of rows)if(live.has(row.time))live.set(row.time,row);
  const oldest=rows[0]?.time??0;for(const time of live.keys())if(time<oldest)live.delete(time);
  series.setData(rows.map(point));if(latest.current)push.current?.(latest.current);
  if((rows.length||live.size)&&!fitted){chart?.timeScale().fitContent();fitted=true;}
 }
 unsubscribe=subscribe("candles:state",snapshot=>{
  if(snapshot?.symbol!==symbol||snapshot.granularity!==interval||!Array.isArray(snapshot.candles))return;
  receivedSnapshot=true;render(snapshot.candles);
  setStatus(snapshot.candles.length?"Cached history, updating live":"No cached history yet. Live candles remain available");
 });
 emit("candles:subscribe",{symbol,granularity:interval});
 if(latest.current)push.current?.(latest.current);
 async function load(){try{
 const to=Math.floor(Date.now()/width)*width,from=to-width*300;
 const p=new URLSearchParams({symbol,granularity:interval,from:String(from),to:String(to)}),response=await fetch("/api/candles?"+p,{signal:controller.signal}),data=await response.json();
 if(!response.ok)throw new Error(data.error||"Chart unavailable");if(closed)return;
 if(receivedSnapshot)return;
 render(data.candles as Row[]);
 setStatus(data.candles.length?"Stored candles, updating live":"No stored candles yet. Live observations appear as they arrive");
 }catch(e){if(!closed){setStatus(e instanceof Error?e.message:"Chart unavailable")}}}
 await load();
 }
 start().catch(()=>setStatus("Could not load chart"));return()=>{closed=true;controller.abort();unsubscribe?.();emit("candles:subscribe",null);push.current=undefined;chart?.remove();};
 },[symbol,interval,subscribe,emit]);
 return <div className="cached-chart"><div className="symbol-tabs" aria-label="Chart interval">{Object.keys(intervals).map(g=><button key={g} aria-pressed={g===interval} onClick={()=>setIntervalName(g as keyof typeof intervals)}>{g}</button>)}</div><div className="chart-shell" ref={node}/><p className="market-note" role="status">{connection==="disconnected"?"Disconnected. Prices are stale. ":""}{status}. <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">Charting by TradingView</a></p></div>;
}
