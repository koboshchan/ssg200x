"use client";
import {Suspense,useCallback,useEffect,useMemo,useRef,useState} from "react";
import {useRouter,useSearchParams} from "next/navigation";
import {useUser} from "@clerk/nextjs";
import {getTabHeaders} from "@/lib/tab-identity";
import {useLive,useLiveEvent} from "./live-provider";
import CasinoAmountInput from "./casino-amount-input";
import styles from "./polymarket.module.css";

type Outcome={label:string;tokenId:string;price:number};
type StreamPrice={marketId:string;live:boolean;serverNow:number;rx?:number;books:{asset_id:string;timestamp:number;bids:{price:string;size:string}[];asks:{price:string;size:string}[]}[]};
type Market={id:string;question:string;outcomes:Outcome[];volume?:number;closed?:boolean};
type PEvent={enabled?:boolean;maxTradeCents?:number;id:string;title:string;category?:string;image?:string;volume?:number;liquidity?:number;endDate?:string;closed?:boolean;description?:string;resolutionSource?:string;markets:Market[]};
type Position={marketId:string;eventId?:string;eventTitle?:string;question:string;side:"yes"|"no";shares:number;avgPrice:number;curPrice:number;costCents:number;valueCents:number;pnlCents:number;status:"open"|"won"|"lost"|"void";priceLive?:boolean;marketClosed?:boolean};
type Activity={t:number;type:string;marketId?:string;question?:string;side?:string;shares?:number;price?:number;cents?:number};
type Portfolio={wallet:number;positions:Position[];activity:Activity[]};
type Listing={enabled:boolean;maxTradeCents:number;wallet?:number;categories?:string[];events:PEvent[];total?:number};
type Book={bids:{price:number;size:number}[];asks:{price:number;size:number}[]};
type Quote={price:number;shares:number;cents:number;asOf:number;tradable?:boolean;reason?:string;serverNow?:number;rx?:number};
const QUOTE_MAX_AGE=15000;
type Trade={t:number;side?:string;price:number;size:number;user?:string};

const money=(c:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:c%100===0?0:2}).format(c/100);
const compact=(n?:number)=>n==null?"-":"$"+new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:1}).format(n);
const pct=(p:number)=>p<0.01&&p>0?"<1%":Math.round(p*100)+"%";
const cents=(p:number)=>(Math.round(p*1000)/10).toFixed(p*100%1?1:0)+"¢";
const yes=(m:Market)=>m.outcomes.find(o=>/^yes$/i.test(o.label))?.price??m.outcomes[0]?.price??0;
const rid=()=>crypto.randomUUID();
const ago=(t:number)=>{const s=Math.max(0,(Date.now()-t)/1000);return s<60?"just now":s<3600?Math.floor(s/60)+"m ago":s<86400?Math.floor(s/3600)+"h ago":Math.floor(s/86400)+"d ago";};
const SORTS=[["trending","Trending"],["volume","Volume"],["new","New"],["ending","Ending soon"]] as const;

async function api<T>(path:string,init?:RequestInit):Promise<T>{
 const r=await fetch("/api/polymarket"+path,{cache:"no-store",...init,headers:{...getTabHeaders(),...(init?.method==="POST"?{"Content-Type":"application/json",...getTabHeaders()}:{}),...init?.headers}});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw Object.assign(new Error(d.error||"Something went wrong."),{status:r.status});
 return d as T;
}

export default function PolymarketClient(){return <Suspense fallback={<main className={styles.page}><p role="status">Loading…</p></main>}><Inner/></Suspense>;}

function Inner(){
 const {user,isLoaded}=useUser(),uid=user?.id;
 const router=useRouter(),params=useSearchParams(),eventId=params.get("event");
 const [portfolio,setPortfolio]=useState<Portfolio|null>(null),[settings,setSettings]=useState<{enabled:boolean;maxTradeCents:number}|null>(null),[view,setView]=useState<"markets"|"positions">("markets"),[toast,setToast]=useState("");
 const loadPortfolio=useCallback(async()=>{try{setPortfolio(await api<Portfolio>("/portfolio"));}catch{}},[]);
 useEffect(()=>{if(!uid)return;void loadPortfolio();const timer=setInterval(loadPortfolio,15000);return()=>clearInterval(timer);},[uid,loadPortfolio]);
 const portfolioRefresh=useRef<ReturnType<typeof setTimeout>|null>(null);
 useLiveEvent("polymarket:positions",()=>{if(portfolioRefresh.current)return;portfolioRefresh.current=setTimeout(()=>{portfolioRefresh.current=null;void loadPortfolio();},1000);});
 useEffect(()=>()=>{if(portfolioRefresh.current)clearTimeout(portfolioRefresh.current);},[]);
 const open=(id:string|null)=>router.push(id?"/polymarket?event="+encodeURIComponent(id):"/polymarket");
 if(isLoaded&&!uid)return <main className={styles.page}><h1>Predictions</h1><p className={styles.muted}>Sign in to trade real-world markets.</p></main>;
 const wallet=portfolio?.wallet;
 return <main className={styles.page}>
  <div className={styles.head}><div><h1>Predictions</h1><p className={styles.muted}>Live odds from real markets. Play money only.</p></div><div className={styles.wallet}><span>Wallet</span><strong>{wallet==null?"-":money(wallet)}</strong></div></div>
  {settings&&!settings.enabled&&<p className={styles.banner} role="status">Trading is turned off right now. You can still browse and sell is unavailable until it is back.</p>}
  {toast&&<p className={styles.toast} role="status" onClick={()=>setToast("")}>{toast}</p>}
  <div className={styles.tabs} role="tablist"><button role="tab" aria-selected={view==="markets"&&!eventId} className={styles.tab} onClick={()=>{setView("markets");if(eventId)open(null);}}>Markets</button><button role="tab" aria-selected={view==="positions"} className={styles.tab} onClick={()=>{setView("positions");if(eventId)open(null);void loadPortfolio();}}>Positions{portfolio&&portfolio.positions.filter(p=>p.status==="open").length>0&&<span className={styles.badge}>{portfolio.positions.filter(p=>p.status==="open").length}</span>}</button></div>
  {view==="positions"&&!eventId?<Positions portfolio={portfolio} onOpen={open} onTraded={(m)=>{setToast(m);void loadPortfolio();}}/>:eventId?<EventView id={eventId} portfolio={portfolio} settings={settings} onBack={()=>open(null)} onTraded={(m)=>{setToast(m);void loadPortfolio();}}/>:<Browse onOpen={open} onSettings={setSettings}/>}
 </main>;
}

function Browse({onOpen,onSettings}:{onOpen:(id:string)=>void;onSettings:(s:{enabled:boolean;maxTradeCents:number})=>void}){
 const [q,setQ]=useState(""),[dq,setDq]=useState(""),[cat,setCat]=useState(""),[sort,setSort]=useState<string>("trending"),[data,setData]=useState<Listing|null>(null),[err,setErr]=useState(""),[loading,setLoading]=useState(true);
 useEffect(()=>{const t=setTimeout(()=>setDq(q.trim()),300);return()=>clearTimeout(t);},[q]);
 useEffect(()=>{
  let live=true;setLoading(true);setErr("");
  const load=()=>api<Listing>("/events?limit=24&sort="+sort+(cat?"&category="+encodeURIComponent(cat):"")+(dq?"&q="+encodeURIComponent(dq):"")).then(d=>{if(!live)return;setData(d);onSettings({enabled:d.enabled,maxTradeCents:d.maxTradeCents});}).catch(e=>live&&setErr(e.message)).finally(()=>live&&setLoading(false));
  void load();const refresh=setInterval(load,60000);return()=>{live=false;clearInterval(refresh);};
 },[dq,cat,sort,onSettings]);
 const cats=data?.categories||[];
 return <section aria-label="Markets">
  <AdminControls onSettings={onSettings}/>
  <div className={styles.tools}><input className={styles.search} type="search" placeholder="Search markets" aria-label="Search markets" value={q} onChange={e=>setQ(e.target.value)}/><select aria-label="Sort" value={sort} onChange={e=>setSort(e.target.value)} className={styles.sort}>{SORTS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
  {cats.length>0&&<div className={styles.chips} role="group" aria-label="Category"><button className={styles.chip} aria-pressed={!cat} onClick={()=>setCat("")}>All</button>{cats.map(c=><button key={c} className={styles.chip} aria-pressed={cat===c} onClick={()=>setCat(c)}>{c}</button>)}</div>}
  {err&&<p className={styles.error} role="alert">{err}</p>}
  {loading&&!data&&<div className={styles.grid} aria-busy="true">{Array.from({length:6},(_,i)=><div key={i} className={styles.skel}/>)}</div>}
  {data&&data.events.length===0&&!loading&&<p className={styles.empty}>No markets found.</p>}
  {data&&<div className={styles.grid} style={{opacity:loading?.6:1}}>{data.events.map(e=><EventCard key={e.id} e={e} onOpen={onOpen}/>)}</div>}
 </section>;
}

function EventCard({e,onOpen}:{e:PEvent;onOpen:(id:string)=>void}){
 const multi=e.markets.length>1,top=[...e.markets].sort((a,b)=>yes(b)-yes(a));
 return <button className={styles.card} onClick={()=>onOpen(e.id)}>
  <div className={styles.cardTop}>{e.image?<img className={styles.thumb} src={e.image} alt="" width={40} height={40} loading="lazy"/>:<span className={styles.thumb} aria-hidden="true"/>}<h3>{e.title}</h3>{!multi&&e.markets[0]&&<span className={styles.big}>{pct(yes(e.markets[0]))}<small>chance</small></span>}</div>
  {multi?<ul className={styles.rows}>{top.slice(0,3).map(m=><li key={m.id}><span>{m.question}</span><b>{pct(yes(m))}</b></li>)}{top.length>3&&<li className={styles.muted}>+{top.length-3} more</li>}</ul>:e.markets[0]&&<div className={styles.yn}><span className={styles.yes}>Yes {cents(yes(e.markets[0]))}</span><span className={styles.no}>No {cents(1-yes(e.markets[0]))}</span></div>}
  <div className={styles.meta}><span>{compact(e.volume)} Vol.</span>{e.category&&<span>{e.category}</span>}{e.closed&&<span>Closed</span>}</div>
 </button>;
}

function Chart({marketId,ready}:{marketId:string;ready:boolean}){
 const [range,setRange]=useState("1w"),[pts,setPts]=useState<{t:number;p:number}[]|null>(null),[hover,setHover]=useState<number|null>(null);
 useEffect(()=>{let live=true;setPts(null);if(!ready)return;api<{points:{t:number;p:number}[]}>("/markets/"+encodeURIComponent(marketId)+"/history?range="+range).then(d=>live&&setPts(d.points)).catch(()=>live&&setPts([]));return()=>{live=false;};},[marketId,range,ready]);
 const W=600,H=220;
 const path=useMemo(()=>{if(!pts||pts.length<2)return null;const t0=pts[0].t,t1=pts[pts.length-1].t||t0+1;const xy=pts.map(p=>[(p.t-t0)/((t1-t0)||1)*W,H-p.p*H] as const);return {xy,d:xy.map((v,i)=>(i?"L":"M")+v[0].toFixed(1)+" "+v[1].toFixed(1)).join("")};},[pts]);
 const h=hover!=null&&pts&&path?pts[hover]:null,last=pts&&pts.length?pts[pts.length-1]:null;
 return <div className={styles.chart}>
  <div className={styles.chartHead}><b>{(h||last)?pct((h||last)!.p):"-"}<small> chance{h?" · "+new Date(h.t).toLocaleString([],{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):""}</small></b><div className={styles.ranges}>{["1d","1w","1m","all"].map(r=><button key={r} aria-pressed={range===r} onClick={()=>setRange(r)}>{r==="all"?"All":r.toUpperCase()}</button>)}</div></div>
  {pts==null?<div className={styles.chartEmpty}>Loading chart…</div>:!path?<div className={styles.chartEmpty}>Not enough history yet.</div>:
  <svg viewBox={"0 0 "+W+" "+H} preserveAspectRatio="none" role="img" aria-label="Probability history" onPointerLeave={()=>setHover(null)} onPointerMove={e=>{const b=e.currentTarget.getBoundingClientRect(),x=(e.clientX-b.left)/b.width*W;let best=0,bd=1e9;path.xy.forEach((v,i)=>{const d=Math.abs(v[0]-x);if(d<bd){bd=d;best=i;}});setHover(best);}}>
   {[0.25,0.5,0.75].map(g=><line key={g} x1="0" x2={W} y1={H-g*H} y2={H-g*H} className={styles.grid25}/>)}
   <path d={path.d} fill="none" className={styles.line} vectorEffect="non-scaling-stroke"/>
   {hover!=null&&<line x1={path.xy[hover][0]} x2={path.xy[hover][0]} y1="0" y2={H} className={styles.cross} vectorEffect="non-scaling-stroke"/>}
  </svg>}
 </div>;
}

function EventView({id,portfolio,settings,onBack,onTraded}:{id:string;portfolio:Portfolio|null;settings:{enabled:boolean;maxTradeCents:number}|null;onBack:()=>void;onTraded:(m:string)=>void}){
 const [ev,setEv]=useState<PEvent|null>(null),[global,setGlobal]=useState<{enabled:boolean;maxTradeCents:number}|null>(null),[err,setErr]=useState(""),[mid,setMid]=useState<string|null>(null),[tab,setTab]=useState<"book"|"activity"|"about">("book");
 useEffect(()=>{let live=true;setEv(null);setErr("");const load=()=>api<PEvent>("/events/"+encodeURIComponent(id)).then(d=>{if(!live)return;setEv(d);setMid(m=>m&&d.markets.some(x=>x.id===m)?m:d.markets[0]?.id??null);}).catch(e=>live&&setErr(e.message));void load();const t=setInterval(load,20000);return()=>{live=false;clearInterval(t);};},[id]);
 useEffect(()=>{if(settings)return;let live=true;api<Listing>("/events?limit=1").then(d=>live&&setGlobal({enabled:d.enabled,maxTradeCents:d.maxTradeCents})).catch(()=>{});return()=>{live=false;};},[settings]);
 const {connection,request,emit}=useLive();
 const [stream,setStream]=useState<StreamPrice|null>(null);
 useLiveEvent("polymarket:price",(p:StreamPrice)=>{if(p.marketId===mid)setStream({...p,rx:Date.now()});});
 useEffect(()=>{
  setStream(null);if(!mid||connection!=="connected")return;
  let active=true;const watch=()=>{void request("polymarket:watch",mid).then(p=>{if(active)setStream({...p,rx:Date.now()});}).catch(()=>{if(active)setStream(null);});};
  watch();const retry=setInterval(watch,15000);return()=>{active=false;clearInterval(retry);emit("polymarket:watch",null);};
 },[mid,connection,request,emit]);
 const market=ev?.markets.find(m=>m.id===mid);
 const liveStream=connection==="connected"&&stream?.marketId===mid?stream:null;
 const eff=ev&&typeof ev.enabled==="boolean"&&typeof ev.maxTradeCents==="number"?{enabled:ev.enabled,maxTradeCents:ev.maxTradeCents}:settings||global;
 return <section aria-label="Market">
  <button className={styles.back} onClick={onBack}>← All markets</button>
  {err&&<p className={styles.error} role="alert">{err}</p>}
  {!ev&&!err&&<div className={styles.skel} style={{height:300}}/>}
  {ev&&<div className={styles.detail}>
   <div className={styles.main}>
    <div className={styles.cardTop}>{ev.image?<img className={styles.thumb} src={ev.image} alt="" width={56} height={56}/>:<span className={styles.thumb} aria-hidden="true"/>}<div><h2>{ev.title}</h2><div className={styles.meta}><span>{compact(ev.volume)} Vol.</span>{ev.endDate&&<span>Ends {new Date(ev.endDate).toLocaleDateString([],{month:"short",day:"numeric",year:"numeric"})}</span>}{ev.category&&<span>{ev.category}</span>}{ev.closed&&<span>Closed</span>}</div></div></div>
    {market&&<Chart marketId={market.id} ready={liveStream?.marketId===market.id}/>}
    {ev.markets.length>1&&<ul className={styles.outcomes} aria-label="Outcomes">{ev.markets.map(m=><li key={m.id}><button aria-pressed={m.id===mid} onClick={()=>setMid(m.id)}><span>{m.question}</span><b>{pct(yes(m))}</b></button></li>)}</ul>}
    {market&&<><div className={styles.tabs2} role="tablist">{(["book","activity","about"] as const).map(t=><button key={t} role="tab" aria-selected={tab===t} onClick={()=>setTab(t)}>{t==="book"?"Order book":t==="activity"?"Activity":"About"}</button>)}</div>
    {tab==="book"?<BookView market={market} stream={liveStream}/>:tab==="activity"?<ActivityView id={market.id}/>:<div className={styles.about}><p>{ev.description||"No description."}</p>{ev.resolutionSource&&<p className={styles.muted}>Resolution source: {ev.resolutionSource}</p>}<p className={styles.muted}>Markets settle automatically when the real market resolves.</p></div>}</>}
   </div>
   {market&&<Ticket key={market.id} stream={liveStream} ev={ev} market={market} portfolio={portfolio} settings={eff} onTraded={onTraded}/>}
  </div>}
 </section>;
}

function BookView({market,stream}:{market:Market;stream:StreamPrice|null}){
 const token=market.outcomes.find(o=>/^yes$/i.test(o.label))?.tokenId??market.outcomes[0]?.tokenId;
 const raw=stream?.books.find(b=>b.asset_id===token);
 if(!raw||!stream?.live)return <p className={styles.empty}>Waiting for live order book…</p>;
 const b:Book={bids:raw.bids.map(l=>({price:Number(l.price),size:Number(l.size)})),asks:raw.asks.map(l=>({price:Number(l.price),size:Number(l.size)}))};
 const max=Math.max(1,...b.bids.slice(0,8).map(x=>x.size),...b.asks.slice(0,8).map(x=>x.size));
 const side=(rows:Book["bids"],cls:string,title:string)=><div><h4>{title}</h4>{rows.slice(0,8).map((r,i)=><div key={i} className={styles.level}><i className={cls} style={{width:r.size/max*100+"%"}}/><span>{cents(r.price)}</span><span>{Math.round(r.size).toLocaleString()}</span></div>)}{!rows.length&&<p className={styles.muted}>None</p>}</div>;
 return <div className={styles.book}>{side(b.bids,styles.bidBar,"Bids (Yes)")}{side(b.asks,styles.askBar,"Asks (Yes)")}</div>;
}
function ActivityView({id}:{id:string}){
 const [t,setT]=useState<Trade[]|null>(null);
 useEffect(()=>{let live=true;setT(null);api<{trades:Trade[]}>("/markets/"+encodeURIComponent(id)+"/activity").then(d=>live&&setT(d.trades)).catch(()=>live&&setT([]));return()=>{live=false;};},[id]);
 if(!t)return <p className={styles.empty}>Loading…</p>;if(!t.length)return <p className={styles.empty}>No recent trades.</p>;
 return <ul className={styles.feed}>{t.slice(0,30).map((x,i)=><li key={i}><span>{x.user?x.user+" ":""}{x.side?x.side.toLowerCase()+" ":""}{Math.round(x.size).toLocaleString()} shares at {cents(x.price)}</span><span className={styles.muted}>{ago(x.t)}</span></li>)}</ul>;
}

function Ticket({ev,market,portfolio,settings,onTraded,stream}:{stream:StreamPrice|null;ev:PEvent;market:Market;portfolio:Portfolio|null;settings:{enabled:boolean;maxTradeCents:number}|null;onTraded:(m:string)=>void}){
 const [action,setAction]=useState<"buy"|"sell">("buy"),[side,setSide]=useState<"yes"|"no">("yes"),[amount,setAmount]=useState("10"),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[err,setErr]=useState("");
 const reqId=useRef(rid()),reqAt=useRef(Date.now()),dlg=useRef<HTMLDialogElement>(null);
 const py=yes(market);
 const [quote,setQuote]=useState<Quote|null>(null),[quoteErr,setQuoteErr]=useState(false),[tick,setTick]=useState(Date.now());
 useEffect(()=>{const t=setInterval(()=>setTick(Date.now()),1000);return()=>clearInterval(t);},[]);
 const pos=portfolio?.positions.find(p=>p.marketId===market.id&&p.side===side&&p.status==="open");
 const n=Number(amount),valid=action==="buy"?Number.isInteger(n)&&n>0:Number.isFinite(n)&&n>=0.000001&&/^\d*\.?\d{0,6}$/.test(amount);
 const qs="/quote?marketId="+encodeURIComponent(market.id)+"&side="+side+"&action="+action+(valid?(action==="buy"?"&amountCents="+n*100:"&shares="+n):"");
 useEffect(()=>{
  let live=true;setQuote(null);setQuoteErr(false);
  if(!valid||settings?.enabled===false||!stream?.live)return;
  const go=()=>api<Quote>(qs).then(q=>{if(live){setQuote({...q,rx:Date.now()});setQuoteErr(false);}}).catch(()=>{if(live){setQuote(null);setQuoteErr(true);}});
  const d=setTimeout(go,250),t=setInterval(go,3000);return()=>{live=false;clearTimeout(d);clearInterval(t);};
 },[qs,valid,settings?.enabled,stream?.live]);
 const quoteRefresh=useRef(0);
 useEffect(()=>{if(!stream?.live||!valid||Date.now()-quoteRefresh.current<1000)return;quoteRefresh.current=Date.now();let active=true;api<Quote>(qs).then(q=>{if(active){setQuote({...q,rx:Date.now()});setQuoteErr(false);}}).catch(()=>{if(active){setQuote(null);setQuoteErr(true);}});return()=>{active=false;};},[stream,qs,valid]);
 const qAge=quote?((quote.serverNow??quote.rx??tick)-quote.asOf)+(tick-(quote.rx??tick)):Infinity;
 const streamAge=stream?(stream.serverNow-Math.min(...stream.books.map(b=>b.timestamp)))+(tick-(stream.rx??tick)):Infinity;
 const streamLive=!!stream?.live&&streamAge<=10000;
 const fresh=streamLive&&!!quote&&Number.isFinite(quote.asOf)&&quote.tradable!==false&&qAge<=QUOTE_MAX_AGE&&quote.price>0;
 const price=fresh?quote!.price:(side==="yes"?py:1-py);
 const max=settings?.maxTradeCents;
 const shares=action==="buy"?(fresh?quote!.shares:0):(valid?Math.min(n,pos?.shares||0):0);
 const sellAmt=action==="sell"&&valid?Math.min(n,pos?.shares||0):0;
 const payoutC=action==="buy"?shares*100:(fresh?quote!.cents:0);
 const costC=action==="buy"?(valid?n*100:0):0;
 const disabled=busy||!valid||!fresh||settings==null||market.closed||ev.closed||settings?.enabled===false||(action==="buy"&&portfolio!=null&&costC>portfolio.wallet)||(action==="buy"&&max!=null&&costC>max)||(action==="sell"&&(!pos||n>pos.shares+1e-9));
 useEffect(()=>{const d=dlg.current;if(!d)return;if(confirm&&!d.open)d.showModal();if(!confirm&&d.open)d.close();},[confirm]);
 async function submit(){
  setBusy(true);setErr("");
  try{
   const body:Record<string,unknown>={requestId:reqId.current,requestAt:reqAt.current,marketId:market.id,side,action,limitPrice:action==="buy"?Math.min(0.99,Math.ceil((price+0.03)*1000)/1000):Math.max(0.01,Math.floor((price-0.03)*1000)/1000)};
   if(!fresh){setErr("Quote is stale. Try again in a moment.");setBusy(false);return;}
   if(action==="buy")body.amountCents=n*100;else body.shares=Math.round(n*1e6)/1e6;
   const r=await api<{fill:{shares:number;price:number;cents:number}}>("/trade",{method:"POST",body:JSON.stringify(body)});
   reqId.current=rid();reqAt.current=Date.now();setConfirm(false);
   onTraded((action==="buy"?"Bought ":"Sold ")+r.fill.shares.toFixed(2)+" "+side.toUpperCase()+" at "+cents(r.fill.price)+" for "+money(r.fill.cents));
  }catch(e){
   const st=(e as {status?:number}).status;
   // Network failure or ambiguous server error: keep requestId/requestAt so a retry replays the same trade. Definite rejection: next attempt is a fresh envelope.
   const ambiguous=st==null||st>=500||st===408;
   if(!ambiguous){reqId.current=rid();reqAt.current=Date.now();}
   setErr(ambiguous?"No confirmed reply. Retrying is safe, it won't double trade.":e instanceof Error?e.message:"Trade failed.");setConfirm(false);
  }
  finally{setBusy(false);}
 }
 const label=action==="buy"?"Amount ($)":"Shares to sell";
 return <aside className={styles.ticket} aria-label="Trade">
  <p role="status" data-stream-state={streamLive?"live":"waiting"} className={styles.hint}>{streamLive?"LIVE · Shared market stream":"Connecting to live market stream…"}</p>
  <p className={styles.tq}>{market.question}</p>
  <div className={styles.seg} role="group" aria-label="Action">{(["buy","sell"] as const).map(a=><button key={a} aria-pressed={action===a} onClick={()=>{setAction(a);setErr("");setAmount(a==="buy"?"10":"");reqId.current=rid();reqAt.current=Date.now();}}>{a==="buy"?"Buy":"Sell"}</button>)}</div>
  <div className={styles.sides} role="group" aria-label="Outcome"><button className={styles.yesBtn} aria-pressed={side==="yes"} onClick={()=>{setSide("yes");reqId.current=rid();reqAt.current=Date.now();}}>Yes {cents(py)}</button><button className={styles.noBtn} aria-pressed={side==="no"} onClick={()=>{setSide("no");reqId.current=rid();reqAt.current=Date.now();}}>No {cents(1-py)}</button></div>
  <label className={styles.field}><span>{label}</span>{action==="buy"?<CasinoAmountInput value={amount} onChange={v=>{setAmount(v);reqId.current=rid();reqAt.current=Date.now();}} min={1}/>:<input type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={e=>{if(/^\d*\.?\d{0,6}$/.test(e.target.value)){setAmount(e.target.value);reqId.current=rid();reqAt.current=Date.now();}}}/>}</label>
  {action==="sell"&&<div className={styles.quick}><span className={styles.muted}>{pos?"You hold "+(Math.floor(pos.shares*1e6)/1e6)+" "+side.toUpperCase():"No "+side.toUpperCase()+" shares held"}</span>{pos&&<button onClick={()=>{setAmount(String(Math.floor(pos.shares*1e6)/1e6));reqId.current=rid();reqAt.current=Date.now();}}>Max</button>}</div>}
  {action==="buy"&&<div className={styles.quick}>{[5,10,25,100].map(v=><button key={v} onClick={()=>{setAmount(String(v));reqId.current=rid();reqAt.current=Date.now();}}>${v}</button>)}</div>}
  <dl className={styles.sum}><div><dt>{action==="buy"?"Buy price":"Sell price"}</dt><dd>{fresh?cents(price):valid?(quoteErr?"Unavailable":"Quoting…"):"-"}</dd></div><div><dt>{action==="buy"?"Est. shares":"Shares"}</dt><dd>{action==="buy"?(fresh?shares.toFixed(2):"-"):(valid?(Math.min(n,pos?.shares||0)).toString():"-")}</dd></div><div><dt>{action==="buy"?"Payout if "+side.toUpperCase():"You receive"}</dt><dd className={styles.pos}>{payoutC>0?money(Math.round(payoutC)):"-"}</dd></div></dl>
  {valid&&!fresh&&<p className={styles.hint} role="status">{quoteErr||(quote&&qAge>QUOTE_MAX_AGE)?"Live price unavailable, trading paused for this market.":"Getting live price…"}</p>}
  {settings==null&&<p className={styles.hint}>Loading trading limits…</p>}
  {max!=null&&<p className={styles.hint}>Max per trade {money(max)}. Price may move slightly at fill.</p>}
  {err&&<p className={styles.error} role="alert">{err}</p>}
  <button className={"primary "+styles.go} disabled={disabled} onClick={()=>setConfirm(true)}>{settings?.enabled===false?"Trading off":market.closed||ev.closed?"Market closed":valid&&!fresh?"Price unavailable":(action==="buy"?"Buy ":"Sell ")+side.toUpperCase()}</button>
  <dialog ref={dlg} className={styles.dialog} onCancel={e=>{e.preventDefault();if(!busy)setConfirm(false);}} onClose={()=>setConfirm(false)}>
   <h3>Confirm {action}</h3><p>{action==="buy"?"Spend "+money(costC)+" for about "+shares.toFixed(2)+" "+side.toUpperCase()+" at about "+cents(price):"Sell "+sellAmt+" "+side.toUpperCase()+" shares at about "+cents(price)}.</p><p className={styles.muted}>{market.question}</p>
   <div className={styles.actions}><button onClick={()=>setConfirm(false)} disabled={busy}>Cancel</button><button className="primary" onClick={submit} disabled={busy||!fresh}>{busy?"Placing…":"Confirm"}</button></div>
  </dialog>
 </aside>;
}

function Positions({portfolio,onOpen,onTraded}:{portfolio:Portfolio|null;onOpen:(id:string)=>void;onTraded:(m:string)=>void}){
 const [selected,setSelected]=useState<Position|null>(null),[quote,setQuote]=useState<Quote|null>(null),[busy,setBusy]=useState(false),[err,setErr]=useState(""),[tick,setTick]=useState(Date.now());
 const dlg=useRef<HTMLDialogElement>(null),pending=useRef(false),envelope=useRef<{requestId:string;requestAt:number;limitPrice:number}|null>(null);
 const current=portfolio?.positions.find(p=>p.marketId===selected?.marketId&&p.side===selected?.side&&p.status==="open");
 useEffect(()=>{const d=dlg.current;if(!d)return;if(selected&&!d.open)d.showModal();if(!selected&&d.open)d.close();},[selected]);
 useEffect(()=>{
  setQuote(null);if(!selected)return;
  let active=true;
  const refresh=()=>api<Quote>("/quote?marketId="+encodeURIComponent(selected.marketId)+"&side="+selected.side+"&action=sell&shares="+selected.shares).then(q=>{if(active){setQuote({...q,rx:Date.now()});}}).catch(e=>{if(active){setQuote(null);setErr(e.message);}});
  void refresh();const timer=setInterval(refresh,3000),clock=setInterval(()=>setTick(Date.now()),1000);
  return()=>{active=false;clearInterval(timer);clearInterval(clock);};
 },[selected]);
 const age=quote?((quote.serverNow??quote.rx??tick)-quote.asOf)+(tick-(quote.rx??tick)):Infinity;
 const fresh=!!quote&&quote.tradable===true&&quote.price>0&&age<=10000;
 const available=!!current&&!current.marketClosed&&current.shares===selected?.shares;
 async function closePosition(){
  if(pending.current||!selected||!fresh||!available)return;
  pending.current=true;setBusy(true);setErr("");
  envelope.current??={requestId:rid(),requestAt:Date.now(),limitPrice:Math.max(0.01,Math.floor((quote!.price-0.03)*1000)/1000)};
  try{
   const r=await api<{fill:{shares:number;price:number;cents:number}}>("/trade",{method:"POST",body:JSON.stringify({...envelope.current,marketId:selected.marketId,side:selected.side,action:"sell",shares:selected.shares})});
   envelope.current=null;setSelected(null);
   onTraded("Sold "+r.fill.shares+" "+selected.side.toUpperCase()+" for "+money(r.fill.cents));
  }catch(e){
   const st=(e as {status?:number}).status,ambiguous=st==null||st>=500||st===408;
   if(!ambiguous)envelope.current=null;
   setErr(ambiguous?"No confirmed reply. Retrying is safe, it won't double trade.":e instanceof Error?e.message:"Could not close position.");
  }finally{pending.current=false;setBusy(false);}
 }

 if(!portfolio)return <p className={styles.empty}>Loading…</p>;
 const openP=portfolio.positions.filter(p=>p.status==="open"),closed=portfolio.positions.filter(p=>p.status!=="open");
 const val=openP.reduce((s,p)=>s+p.valueCents,0),pnl=openP.reduce((s,p)=>s+p.pnlCents,0);
 const row=(p:Position)=><tr key={p.marketId+p.side}><th scope="row"><button className={styles.link} onClick={()=>p.eventId&&onOpen(p.eventId)}>{p.question}</button><small>{p.eventTitle}</small></th><td><span className={p.side==="yes"?styles.yes:styles.no}>{p.side.toUpperCase()}</span></td><td>{p.shares.toFixed(2)}</td><td>{cents(p.avgPrice)}</td><td>{p.status==="open"?cents(p.curPrice)+(p.priceLive===false?" (stale)":""):p.status}</td><td>{money(p.valueCents)}</td><td className={p.pnlCents>=0?styles.pos:styles.neg}>{p.pnlCents>=0?"+":""}{money(p.pnlCents)}</td><td className={styles.closeCell}>{p.status==="open"?<button disabled={busy||p.marketClosed} title={p.marketClosed?"Market closed, awaiting settlement":undefined} onClick={()=>{setErr("");envelope.current=null;setSelected(p);}}>Close</button>:<span className={styles.muted}>Settled</span>}</td></tr>;
 const tbl=(rows:Position[])=><div className={styles.scroll}><table className={styles.table}><thead><tr><th>Market</th><th>Side</th><th>Shares</th><th>Avg</th><th>Now</th><th>Value</th><th>P&amp;L</th><th className={styles.closeCell}><span className={styles.srOnly}>Action</span></th></tr></thead><tbody>{rows.map(row)}</tbody></table></div>;
 return <section aria-label="Positions">
  <div className={styles.stats}><div><span>Open value</span><strong>{money(val)}</strong></div><div><span>Open P&amp;L</span><strong className={pnl>=0?styles.pos:styles.neg}>{pnl>=0?"+":""}{money(pnl)}</strong></div></div>
  {openP.length?tbl(openP):<p className={styles.empty}>No open positions.</p>}
  {closed.length>0&&<><h3 className={styles.h3}>Settled</h3>{tbl(closed)}</>}
  <dialog ref={dlg} aria-labelledby="close-position-title" className={styles.dialog} onCancel={e=>{e.preventDefault();if(!busy)setSelected(null);}} onClose={()=>{if(!busy)setSelected(null);}}>
   <h3 id="close-position-title">Close position</h3>
   {selected&&<><p>Sell all {selected.shares} {selected.side.toUpperCase()} shares.</p><p className={styles.muted}>{selected.question}</p></>}
   <p>Estimated proceeds: <strong>{fresh?money(quote!.cents):"Getting live price…"}</strong></p>
   <p className={styles.hint}>Filled at the current live price. Proceeds may change slightly.</p>
   {!available&&<p role="status" className={styles.error}>Position changed or market closed. Refresh positions before trying again.</p>}
   {quote?.tradable===false&&<p role="status" className={styles.error}>{quote.reason||"Live price unavailable."}</p>}
   {err&&<p role="alert" className={styles.error}>{err}</p>}
   <div className={styles.actions}><button disabled={busy} onClick={()=>setSelected(null)}>Cancel</button><button className="primary" disabled={busy||!fresh||!available} onClick={()=>void closePosition()}>{busy?"Closing…":"Confirm"}</button></div>
  </dialog>
  <h3 className={styles.h3}>Activity</h3>
  {portfolio.activity.length?<ul className={styles.feed}>{portfolio.activity.slice(0,40).map((a,i)=><li key={i}><span>{a.type==="settle"?"Settled":a.type==="buy"?"Bought":"Sold"} {a.shares!=null?a.shares.toFixed(2)+" ":""}{a.side?.toUpperCase()} · {a.question}{a.cents!=null?" · "+money(a.cents):""}</span><span className={styles.muted}>{ago(a.t)}</span></li>)}</ul>:<p className={styles.empty}>Nothing yet.</p>}
 </section>;
}

function AdminControls({onSettings}:{onSettings:(s:{enabled:boolean;maxTradeCents:number})=>void}){
 const [cfg,setCfg]=useState<{enabled:boolean;maxTradeCents:number;version?:number}|null>(null),[max,setMax]=useState(""),[busy,setBusy]=useState(false),[err,setErr]=useState("");
 useEffect(()=>{api<{enabled:boolean;maxTradeCents:number;version?:number}>("/settings").then(d=>{setCfg(d);setMax(String(d.maxTradeCents/100));}).catch(()=>{});},[]);
 if(!cfg)return null;
 async function save(enabled:boolean){
  const m=Number(max);if(!Number.isInteger(m)||m<1||m>1000000){setErr("Max trade must be whole dollars from $1 to $1,000,000.");return;}
  setBusy(true);setErr("");
  try{const d=await api<{enabled:boolean;maxTradeCents:number;version?:number}>("/settings",{method:"POST",body:JSON.stringify({enabled,maxTradeCents:m*100,expectedVersion:cfg?.version})});setCfg(d);setMax(String(d.maxTradeCents/100));onSettings({enabled:d.enabled,maxTradeCents:d.maxTradeCents});}
  catch(e){setErr(e instanceof Error?e.message:"Could not save.");}finally{setBusy(false);}
 }
 return <details className={styles.admin}><summary>Admin controls</summary><div className={styles.adminRow}><label className={styles.field}><span>Max trade ($)</span><CasinoAmountInput value={max} onChange={setMax} min={1}/></label><button disabled={busy} onClick={()=>void save(cfg.enabled)}>Save</button><button className={cfg.enabled?"":"primary"} disabled={busy} onClick={()=>void save(!cfg.enabled)}>{cfg.enabled?"Turn trading off":"Turn trading on"}</button></div>{err&&<p className={styles.error} role="alert">{err}</p>}</details>;
}
