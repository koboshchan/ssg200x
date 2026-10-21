"use client";
import {getTabHeaders} from "@/lib/tab-identity";
import {useCallback,useEffect,useState} from "react";
type Kind="crypto"|"stocks"|"forex";
type Affected={holdings:number;positions:number;accounts:number};
type Data={marketSymbols:{crypto:string[];stocks:string[];forex?:string[];delisted:string[]};affected:Record<string,Affected>;version:number};
import {MAX_ACTIVE_STOCKS as MAX_STOCKS} from "@/lib/symbol-registry";
const kinds:{kind:Kind;label:string}[]=[{kind:"crypto",label:"Crypto"},{kind:"stocks",label:"Stocks"},{kind:"forex",label:"Forex"}];
export default function MarketSymbolSettings(){
 const [data,setData]=useState<Data|null>(null),[hidden,setHidden]=useState(false),[error,setError]=useState(""),[busy,setBusy]=useState(false),[drafts,setDrafts]=useState<Record<Kind,string>>({crypto:"",stocks:"",forex:""});
 const load=useCallback(async()=>{
  try{const r=await fetch("/api/admin/symbols",{cache:"no-store"});
   if(r.status===403){setHidden(true);return;}
   const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Could not load symbols.");
   setData(j);
  }catch(e){setError(e instanceof Error?e.message:"Could not load symbols.");}
 },[]);
 useEffect(()=>{void load();},[load]);
 async function mutate(action:"add"|"remove",kind:Kind,symbol:string,confirmed?:boolean){
  if(!data||busy)return;setBusy(true);setError("");
  try{const r=await fetch("/api/admin/symbols",{method:"POST",headers:{"content-type":"application/json",...getTabHeaders()},body:JSON.stringify({action,kind,symbol,expectedVersion:data.version,...(confirmed?{confirmed:true}:{})})});
   if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||(r.status===409?"Symbols changed elsewhere. Reloaded, try again.":"Could not save."));
   if(action==="add")setDrafts(d=>({...d,[kind]:""}));
  }catch(e){setError(e instanceof Error?e.message:"Could not save.");}
  finally{setBusy(false);await load();}
 }
 function remove(kind:Kind,symbol:string){
  const a=data?.affected[symbol]??{holdings:0,positions:0,accounts:0};
  const ok=window.confirm(`Remove ${symbol}?\n\n${a.holdings} holdings and ${a.positions} open positions across ${a.accounts} accounts are affected.\n\nPlayer claims are retained. Redemption is manual at the cached USD price, and open positions are not closed automatically.`);
  if(ok)void mutate("remove",kind,symbol,true);
 }
 if(hidden)return null;
 return <section className="admin-block" aria-labelledby="market-symbols-title">
  <h2 id="market-symbols-title">Market symbols</h2>
  {!data?<p className="admin-note" role="status">Loading symbols…</p>:<>
   {kinds.map(({kind,label})=>{const list=data.marketSymbols[kind]??[],full=kind==="stocks"&&list.length>=MAX_STOCKS;
    return <fieldset key={kind} className="admin-set" disabled={busy}><legend>{label}<span className="admin-count">{kind==="stocks"?`${list.length} / ${MAX_STOCKS} active`:`${list.length} active`}</span></legend>
    <ul className="admin-list">{list.map(sym=><li key={sym}><span className="admin-sym">{sym}</span><button type="button" className="admin-remove" aria-label={`Remove ${sym}`} onClick={()=>remove(kind,sym)}>Remove</button></li>)}{list.length?null:<li className="admin-note">None active.</li>}</ul>
    <form className="admin-add" onSubmit={e=>{e.preventDefault();const v=drafts[kind].trim().toUpperCase();if(v&&!full)void mutate("add",kind,v);}}>
     <input aria-label={`Add ${label.toLowerCase()} symbol`} placeholder={kind==="forex"?"Add pair, e.g. EUR/USD":`Add ${label.toLowerCase()} symbol`} value={drafts[kind]} maxLength={15} {...(kind==="forex"?{pattern:"[A-Z]{3}/[A-Z]{3}",title:"Currency pair like EUR/USD."}:{pattern:"[A-Z][A-Z0-9.\-]{0,14}",title:"Start with a letter. Up to 15 capital letters, numbers, dots or dashes."})} onChange={e=>setDrafts(d=>({...d,[kind]:e.target.value.toUpperCase()}))} autoCapitalize="characters" autoComplete="off" spellCheck={false} disabled={full}/>
     <button type="submit" className="primary" disabled={full||!drafts[kind].trim()}>Add</button>
    </form>
    {full?<p className="admin-note">Stock limit reached. Remove one to add another.</p>:null}
   </fieldset>;})}
   {data.marketSymbols.delisted.length?<ForexCadence/><p className="admin-note">Delisted: {data.marketSymbols.delisted.join(", ")}</p>:null}
  </>}
  {error?<div className="error" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError("")}>×</button></div>:null}
 </section>;
}

type FxStatus={mode:"mock"|"live"|"unconfigured";marketOpen:boolean;cadenceSeconds:number;dailyUsed:number;dailyLimit:number;message:string};
function ForexCadence(){
 const [st,setSt]=useState<FxStatus|null>(null),[draft,setDraft]=useState(""),[err,setErr]=useState(""),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{try{const r=await fetch("/api/admin/forex",{cache:"no-store"});if(!r.ok)return;const j=await r.json();setSt(j.forexStatus??j);}catch{}},[]);
 useEffect(()=>{void load();},[load]);
 if(!st)return null;
 async function save(e:React.FormEvent){e.preventDefault();const n=Number(draft);if(!Number.isInteger(n)||n<1||busy)return;setBusy(true);setErr("");
  try{const r=await fetch("/api/admin/forex",{method:"POST",headers:{"content-type":"application/json",...getTabHeaders()},body:JSON.stringify({cadenceSeconds:n})});if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||"Could not save.");setDraft("");}
  catch(x){setErr(x instanceof Error?x.message:"Could not save.");}finally{setBusy(false);await load();}}
 return <fieldset className="admin-set" disabled={busy}><legend>Forex feed<span className="admin-count">{st.mode==="mock"?"MOCK data":st.mode==="live"?"live":"not configured"}</span></legend>
  <p className="admin-note">{st.message} Refresh every {st.cadenceSeconds}s · {st.dailyUsed} / {st.dailyLimit} daily requests · market {st.marketOpen?"open":"closed"}. Only live USD-quoted pairs can trade; mock and JPY pairs are view only.</p>
  <form className="admin-add" onSubmit={save}><input type="number" min="1" step="1" aria-label="Forex refresh seconds" placeholder="Refresh seconds" value={draft} onChange={e=>setDraft(e.target.value)}/><button type="submit" className="primary" disabled={!draft.trim()}>Set</button></form>
  {err?<div className="error" role="alert">{err}</div>:null}
 </fieldset>;
}
