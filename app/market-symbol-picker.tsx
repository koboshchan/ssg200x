"use client";
import {useEffect,useMemo,useState} from "react";
import {createPortal} from "react-dom";
import type {MarketSummary} from "@/lib/market-summary";
import {stockDisplayName} from "@/lib/stock-config";
import styles from "./market-symbol-picker.module.css";
type Quote={micro:number;at:number};
export type MarketSymbols={crypto:string[];stocks:string[];forex?:string[];delisted:string[];revision:number};
export const isForexPair=(s:string)=>/^[A-Z]{3}\/[A-Z]{3}$/.test(s);
const rate=(m:number)=>new Intl.NumberFormat("en-US",{minimumFractionDigits:4,maximumFractionDigits:4}).format(m/1e6);
type Props={symbol:string|null;symbols:MarketSymbols;quotes:Record<string,Quote|undefined>;changes?:Record<string,number|null|undefined>;summary?:MarketSummary;forexMock?:boolean;onSelect:(s:string)=>void};
const price=(m:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2}).format(m/1e6);
function Change({v}:{v:number|null|undefined}){
 if(v==null||!Number.isFinite(v))return <span className={styles.na} title="Change since first live quote today (UTC). Unavailable.">n/a</span>;
 return <span title="Change since first live quote today (UTC)" className={v>=0?styles.up:styles.down}>{(v>=0?"+":"")+v.toFixed(2)}%</span>;
}
/** Current-symbol button (chart top-left) that opens a left sidebar of every active market. */
export default function MarketSymbolPicker({symbol,symbols,quotes,changes,summary,forexMock,onSelect}:Props){
 const [open,setOpen]=useState(false),[term,setTerm]=useState("");
 useEffect(()=>{if(!open)return;const k=(e:KeyboardEvent)=>{if(e.key==="Escape")setOpen(false);};addEventListener("keydown",k);return()=>removeEventListener("keydown",k);},[open]);
 const match=(s:string)=>{const t=term.trim().toLowerCase();return !t||s.toLowerCase().includes(t)||stockDisplayName(s).toLowerCase().includes(t);};
 const groups=useMemo(()=>[["Stocks",symbols.stocks.filter(match)],["Crypto",symbols.crypto.filter(match)],["Forex",(symbols.forex??[]).filter(match)]] as const,[symbols.stocks,symbols.crypto,symbols.forex,term]);
 const q=symbol?quotes[symbol]:undefined;
 const rowMicro=(s:string)=>isForexPair(s)?quotes[s]?.micro:summary?summary[s]?.micro:quotes[s]?.micro;
 const row=(s:string)=><li key={s}><button className={styles.row} aria-current={s===symbol} onClick={()=>{onSelect(s);setOpen(false);}}><span className={styles.name}>{stockDisplayName(s)}</span><span className={styles.nums}><span>{rowMicro(s)!=null?(isForexPair(s)?rate(rowMicro(s)!):price(rowMicro(s)!)):"Unavailable"}{isForexPair(s)&&forexMock?<small title="Demo data, not a real price"> MOCK</small>:null}</span><Change v={summary?summary[s]?.change:changes?.[s]}/></span></button></li>;
 return <>
  <button className={styles.trigger} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}>{symbol?<>{isForexPair(symbol)?symbol:stockDisplayName(symbol)+" / USD"} <small>{q?(isForexPair(symbol)?rate(q.micro):price(q.micro)):""}{isForexPair(symbol)&&forexMock?" MOCK":""}</small></>:"No markets"}<span aria-hidden>▾</span></button>
  {open?createPortal(<><div className={styles.scrim} onClick={()=>setOpen(false)}/><aside className={styles.drawer} role="dialog" aria-label="Choose a market">
   <div className={styles.head}><h3>Markets</h3><button onClick={()=>setOpen(false)} aria-label="Close">×</button></div>
   <input className={styles.search} type="search" placeholder="Search symbols" aria-label="Search symbols" value={term} onChange={e=>setTerm(e.target.value)} autoFocus/>
   <ul className={styles.list}>{groups.map(([name,list])=>list.length?<li key={name}><div className={styles.group}>{name.toUpperCase()}</div><ul style={{listStyle:"none",margin:0,padding:0}}>{list.map(row)}</ul></li>:null)}
    {!groups.some(([,l])=>l.length)?<li className={styles.empty}>{symbols.stocks.length+symbols.crypto.length+(symbols.forex?.length??0)?"No matches.":"No markets are active."}</li>:null}</ul>
  </aside></>,document.body):null}
 </>;
}
