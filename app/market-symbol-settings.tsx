"use client";
import {getTabHeaders} from "@/lib/tab-identity";
import {useCallback,useEffect,useState} from "react";
import {ConfirmDialog} from "./confirm-dialog";
type Kind="crypto"|"stocks"|"forex";
type Affected={holdings:number;positions:number;accounts:number};
type Data={marketSymbols:{crypto:string[];stocks:string[];forex?:string[];delisted:string[]};affected:Record<string,Affected>;version:number};
import {MAX_ACTIVE_STOCKS as MAX_STOCKS} from "@/lib/symbol-registry";
const MAX_FOREX=8;
const kinds:{kind:Kind;label:string}[]=[{kind:"crypto",label:"Crypto"},{kind:"stocks",label:"Stocks"},{kind:"forex",label:"Forex"}];
export default function MarketSymbolSettings(){
 const [data,setData]=useState<Data|null>(null),[hidden,setHidden]=useState(false),[error,setError]=useState(""),[busy,setBusy]=useState(false),[pendingRemove,setPendingRemove]=useState<{kind:Kind;symbol:string}|null>(null),[drafts,setDrafts]=useState<Record<Kind,string>>({crypto:"",stocks:"",forex:""});
 const [staged,setStaged]=useState<string[]|null>(null),[confirmFx,setConfirmFx]=useState(false);
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
function remove(kind:Kind,symbol:string){if(kind==="forex"){setStaged((staged??data?.marketSymbols.forex??[]).filter(x=>x!==symbol));return;}setPendingRemove({kind,symbol});}
 async function saveForex(){
  if(!data||!staged||busy)return;setBusy(true);setError("");
  try{const r=await fetch("/api/admin/forex",{method:"PUT",headers:{"content-type":"application/json",...getTabHeaders()},body:JSON.stringify({pairs:staged,expectedVersion:data.version,confirmed:true})});
   if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||(r.status===409?"Symbols changed elsewhere. Reloaded, review and save again.":"Could not save pairs."));
   const snap=await r.json().catch(()=>null);if(snap?.marketSymbols)setData(snap);
   setStaged(null);
  }catch(e){setError(e instanceof Error?e.message:"Could not save pairs.");}
  finally{setBusy(false);setConfirmFx(false);await load();}
 }
 const pa=pendingRemove?data?.affected[pendingRemove.symbol]??{holdings:0,positions:0,accounts:0}:null;
 if(hidden)return null;
 return <section className="admin-block" aria-labelledby="market-symbols-title">
  <h2 id="market-symbols-title">Market symbols</h2>
  {!data?<p className="admin-note" role="status">Loading symbols…</p>:<>
   {kinds.map(({kind,label})=>{const saved=data.marketSymbols[kind]??[],list=kind==="forex"&&staged?staged:saved,full=(kind==="stocks"&&list.length>=MAX_STOCKS)||(kind==="forex"&&list.length>=MAX_FOREX);
    return <fieldset key={kind} className="admin-set" disabled={busy}><legend>{label}<span className="admin-count">{kind==="stocks"?`${list.length} / ${MAX_STOCKS} active`:kind==="forex"?`${list.length} / ${MAX_FOREX} active`:`${list.length} active`}</span></legend>
    <ul className="admin-list">{list.map(sym=><li key={sym}><span className="admin-sym">{sym}</span><button type="button" className="admin-remove" aria-label={`Remove ${sym}`} onClick={()=>remove(kind,sym)}>Remove</button></li>)}{list.length?null:<li className="admin-note">None active.</li>}</ul>
    <form className="admin-add" onSubmit={e=>{e.preventDefault();const v=drafts[kind].trim().toUpperCase();if(v&&!full){if(kind==="forex"){if(!list.includes(v))setStaged([...list,v]);setDrafts(d=>({...d,forex:""}));}else void mutate("add",kind,v);}}}>
     <input aria-label={`Add ${label.toLowerCase()} symbol`} placeholder={kind==="forex"?"Add pair, e.g. USD/CNH":`Add ${label.toLowerCase()} symbol`} value={drafts[kind]} maxLength={15} {...(kind==="forex"?{pattern:"[A-Z]{3}/[A-Z]{3}",title:"Currency pair like EUR/USD."}:{pattern:"[A-Z][A-Z0-9.\\-]{0,14}",title:"Start with a letter. Up to 15 capital letters, numbers, dots or dashes."})} onChange={e=>setDrafts(d=>({...d,[kind]:e.target.value.toUpperCase()}))} autoCapitalize="characters" autoComplete="off" spellCheck={false} disabled={full}/>
     <button type="submit" className="primary" disabled={full||!drafts[kind].trim()}>Add</button>
    </form>
    {kind==="forex"&&staged?<div className="admin-add"><p className="admin-note" role="status">Unsaved changes: {staged.filter(x=>!saved.includes(x)).length} to add, {saved.filter(x=>!staged.includes(x)).length} to remove. Nothing is applied until you save.</p><button type="button" className="primary" disabled={busy||!(staged.length!==saved.length||staged.some((x,i)=>x!==saved[i]))} onClick={()=>setConfirmFx(true)}>Save pairs</button><button type="button" disabled={busy} onClick={()=>setStaged(null)}>Discard</button></div>:null}
    {full?<p className="admin-note">{kind==="forex"?"Forex limit of 8 pairs reached.":"Stock limit reached."} Remove one to add another.</p>:null}
   </fieldset>;})}
   <ForexFeed/>
   {data.marketSymbols.delisted.length?<p className="admin-note">Delisted: {data.marketSymbols.delisted.join(", ")}</p>:null}
  </>}
  <ConfirmDialog open={confirmFx} title="Save forex pairs?" confirmLabel="Save" danger={!!staged&&(data?.marketSymbols.forex??[]).some(x=>!staged.includes(x))} onCancel={()=>setConfirmFx(false)} onConfirm={()=>void saveForex()}>
   <p>New list: {staged?.join(", ")||"none"}. It is checked and saved in one step.</p>
   {staged&&(data?.marketSymbols.forex??[]).filter(x=>!staged.includes(x)).map(x=>{const a=data?.affected[x]??{holdings:0,positions:0,accounts:0};return <p key={x}>Removing {x}: {a.holdings} holdings and {a.positions} open positions across {a.accounts} accounts. Claims are retained, nothing is closed automatically.</p>;})}
  </ConfirmDialog>
  <ConfirmDialog open={!!pendingRemove} title={"Remove "+(pendingRemove?.symbol??"")+"?"} confirmLabel="Remove" danger onCancel={()=>setPendingRemove(null)} onConfirm={()=>{const p=pendingRemove;setPendingRemove(null);if(p)void mutate("remove",p.kind,p.symbol,true);}}>
   <p>{pa?.holdings??0} holdings and {pa?.positions??0} open positions across {pa?.accounts??0} accounts are affected.</p>
   <p>Player claims are retained. Redemption is manual at the cached USD price, and open positions are not closed automatically.</p>
  </ConfirmDialog>
  {error?<div className="error" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError("")}>×</button></div>:null}
 </section>;
}

type FxStatus={mode:"mock"|"live"|"unconfigured";marketOpen:boolean;message:string;stream?:"streaming"|"connecting"|"reconnecting"|"down";lastTickAt?:number};
function ForexFeed(){
 const [st,setSt]=useState<FxStatus|null>(null);
 const load=useCallback(async()=>{try{const r=await fetch("/api/admin/forex",{cache:"no-store"});if(!r.ok)return;const j=await r.json();setSt(j.forexStatus??j);}catch{}},[]);
 useEffect(()=>{void load();const t=setInterval(()=>void load(),5000);return()=>clearInterval(t);},[load]);
 if(!st)return null;
 const state=st.mode==="mock"?"MOCK data":st.mode==="unconfigured"?"not configured":st.stream==="streaming"?"streaming":st.stream==="down"?"stream down":st.stream==="reconnecting"?"reconnecting":"connecting";
 return <fieldset className="admin-set"><legend>Forex feed<span className="admin-count">{state}</span></legend>
  <p className="admin-note">{st.message} Live OANDA stream, shared by all players · market {st.marketOpen?"open":"closed"}. Trading is allowed only when the server reports a fresh live quote and conversion route.</p>
 </fieldset>;
}
