"use client";
import {useEffect,useRef,useState} from "react";
import type {Symbol} from "@/lib/market-shared";
const intervals={"1m":60000,"5m":300000,"15m":900000,"1h":3600000,"6h":21600000,"1d":86400000};
type Row={time:number;open:number;high:number;low:number;close:number};
export default function CachedChart({symbol}:{symbol:Symbol}){
 const node=useRef<HTMLDivElement>(null),[interval,setIntervalName]=useState<keyof typeof intervals>("1h"),[status,setStatus]=useState("Loading cached candles");
 useEffect(()=>{
 let closed=false,timer:ReturnType<typeof setTimeout>,chart:import("lightweight-charts").IChartApi|undefined;const controller=new AbortController();
 const width=intervals[interval],to=Math.floor(Date.now()/width)*width,from=to-width*300;
 async function start(){
 const {createChart,CandlestickSeries,ColorType}=await import("lightweight-charts");if(closed||!node.current)return;
 const dark=matchMedia("(prefers-color-scheme: dark)").matches;
 chart=createChart(node.current,{autoSize:true,layout:{background:{type:ColorType.Solid,color:dark?"#1c1c1e":"#fff"},textColor:dark?"#eee":"#333",attributionLogo:true},grid:{vertLines:{color:dark?"#303033":"#f0f0f0"},horzLines:{color:dark?"#303033":"#f0f0f0"}},timeScale:{timeVisible:true}});
 const series=chart.addSeries(CandlestickSeries);
 let fitted=false;
 async function load(){try{
 const p=new URLSearchParams({symbol,granularity:interval,from:String(from),to:String(to)}),response=await fetch("/api/candles?"+p,{signal:controller.signal}),data=await response.json();
 if(!response.ok)throw new Error(data.error||"Chart unavailable");if(closed)return;
 const rows=(data.candles as Row[]).map(c=>({time:Math.floor(c.time/1000) as import("lightweight-charts").UTCTimestamp,open:c.open,high:c.high,low:c.low,close:c.close}));
 series.setData(rows);if(rows.length&&!fitted){chart?.timeScale().fitContent();fitted=true;}
 setStatus(data.status==="unavailable"?"Coinbase does not offer this symbol’s historical candles":data.status==="cached"?"Cached Coinbase USD candles":rows.length?"Updating cached history":"Fetching missing history");
 timer=setTimeout(load,data.status==="pending"?1500:10000);
 }catch(e){if(!closed){setStatus(e instanceof Error?e.message:"Chart unavailable");timer=setTimeout(load,10000);}}}
 await load();
 }
 start().catch(()=>setStatus("Could not load chart"));return()=>{closed=true;controller.abort();clearTimeout(timer);chart?.remove();};
 },[symbol,interval]);
 return <div><div className="symbol-tabs" aria-label="Chart interval">{Object.keys(intervals).map(g=><button key={g} aria-pressed={g===interval} onClick={()=>setIntervalName(g as keyof typeof intervals)}>{g}</button>)}</div><div className="chart-shell" ref={node}/><p className="market-note" role="status">{status}. <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">Charting by TradingView</a></p></div>;
}
