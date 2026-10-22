import React,{useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {Markets} from "../../app/finance-client";
import {refreshFeatures} from "../../app/use-features";
const now=Date.now();
const mk=(micro:number)=>({micro,at:now+3600_000});
const symbols={crypto:["BTC","ETH"],stocks:["AAPL","TSLA"],forex:["EUR/USD","USD/JPY"],delisted:[],revision:1};
function makeRoom(stockOpen:boolean,staleCrypto:boolean){
 const quotes:any={BTC:mk(84_500_000_000),ETH:staleCrypto?{micro:3_000_000_000,at:0}:mk(3_000_000_000),AAPL:mk(230_000_000),TSLA:mk(250_000_000)};
 const fxq:any={"EUR/USD":{micro:1_080_000,at:now+3600_000,source:"oanda",quoteCurrency:"USD"},"USD/JPY":{micro:150_000_000,at:now+3600_000,source:"oanda",quoteCurrency:"USD",usdMicro:6_666}};
 const stockExecution:any=Object.fromEntries(["AAPL","TSLA"].map(s=>[s,stockOpen?{executable:true,validUntil:now+3600_000}:{executable:false,reason:"closed_or_calendar_unverified",validUntil:now+3600_000}]));
 const pos=(id:string,symbol:string,entry:number)=>({id,symbol,side:"long",leverage:5,margin:10000,entry,liquidation:Math.round(entry*.8),pnl:123,equity:10123,openingFee:30,feePpm:500,closingFeePpm:500,closingFeeMode:"notional",openedAt:now});
 const hold=(symbol:string,v:number)=>({symbol,units:1000,cost:v,value:v});
 return {serverNow:now,limits:{maxTrade:10000,maxLeverage:100},perpOpeningFeePpm:500,perpClosingFeePpm:500,perpClosingFeeMode:"notional",maintenancePercent:1,
  me:{wallet:500000,triggerInputMode:"price",skipCloseConfirmation:false},marketSymbols:symbols,marketSummary:{},marketChanges:{},quotes,stockExecution,legacyAssets:[],
  forexQuotes:fxq,forexStatus:{mode:"live",stream:"streaming",marketOpen:true,message:""},forexExecution:{"EUR/USD":{executable:true,validUntil:now+3600_000},"USD/JPY":{executable:true,validUntil:now+3600_000}},
  holdings:[hold("BTC",5000),hold("ETH",4000),hold("AAPL",500),hold("EUR/USD",2000)],
  positions:[pos("p1","BTC",84_500_000_000),pos("p2","ETH",3_000_000_000),pos("p3","AAPL",230_000_000),pos("p4","EUR/USD",1_080_000)],
  closedPositions:[],spins:[],perpsCloseAll:undefined} as any;
}
const KEYS=["stocks","forex","cryptoSpot","cryptoPerps"] as const;
function Demo(){
 const [flags,setFlags]=useState<Record<string,boolean>>({});const [stockOpen,setStockOpen]=useState(false),[stale,setStale]=useState(true);
 const [sent,setSent]=useState<any[]>([]);
 const load=()=>fetch("/api/features").then(r=>r.json()).then(j=>setFlags(j.features));
 useEffect(()=>{void load();},[]);
 const set=async(k:string,v:boolean)=>{await fetch("/flags",{method:"POST",body:JSON.stringify({[k]:v})});await refreshFeatures();await load();};
 const [room]=useState(()=>makeRoom(false,true));
 const live=makeRoom(stockOpen,stale);
 const post=async(path:string,body:object)=>{setSent(s=>[...s,body]);};
 return <><header className="mast" style={{position:"static"}}><span className="wordmark">ssg200x</span><span>Disabled listings preview · synthetic fixture, no provider</span></header>
 <fieldset id="controls" style={{margin:12}}><legend>Feature flags</legend>{KEYS.map(k=><label key={k} style={{marginRight:12}}><input type="checkbox" name={k} checked={flags[k]!==false} onChange={e=>void set(k,e.target.checked)}/> {k}</label>)}
  <label style={{marginRight:12}}><input type="checkbox" name="stockOpen" checked={stockOpen} onChange={e=>setStockOpen(e.target.checked)}/> stock market open</label>
  <label><input type="checkbox" name="cryptoFresh" checked={!stale} onChange={e=>setStale(!e.target.checked)}/> ETH quote fresh</label></fieldset>
 <p id="sent" style={{margin:12}}>Sent orders: {sent.length}{sent.length?" "+JSON.stringify(sent[sent.length-1]):""}</p>
 <main style={{padding:12}}><Markets room={live} busy={false} post={post}/></main></>;
}
createRoot(document.getElementById("root")!).render(<Demo/>);
