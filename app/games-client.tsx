"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {useUser} from "@clerk/nextjs";
import {useLive} from "./live-provider";
import {getTabHeaders} from "@/lib/tab-identity";
import CasinoAmountInput from "./casino-amount-input";
import {casinoInputCents} from "@/lib/casino-amount";
import styles from "./games.module.css";

type Kind="plinko"|"hilo"|"mines"|"dice"|"chicken";
type Status="active"|"won"|"lost"|"cashed";
type GameView={id:string;kind:Kind;bet:number;status:Status;revision:number;steps:number;multiplier:number;payout:number;createdAt:number;card?:number;cards?:number[];revealed?:number[];bombs?:number[];mines?:number;result?:{path?:number[];slot?:number;roll?:number;hit?:number;card?:number};target?:number;direction?:"over"|"under"};
type Snapshot={version:number;wallet:number;maxBet:number;serverNow:number;games:GameView[];houseEdge:number};
type Pending={body:string;label:string};
type Drop={rid:string;body:string;label:string;state:"sending"|"unconfirmed"};
type Ball={id:string;game:GameView};
const MAX_DROPS=8;
const reserved=(l:Drop[])=>l.reduce((n,d)=>{try{return n+(JSON.parse(d.body).amount|0);}catch{return n;}},0);
const dkey=(u:string)=>"ssg-games-plinko-v1:"+u;
const KINDS:{kind:Kind;label:string;blurb:string}[]=[{kind:"plinko",label:"Plinko",blurb:"Drop the ball, land a multiplier."},{kind:"hilo",label:"Hi-Lo",blurb:"Guess higher or lower, cash out any time."},{kind:"mines",label:"Mines",blurb:"Reveal gems, avoid the mines."},{kind:"dice",label:"Dice",blurb:"Roll over or under your target."},{kind:"chicken",label:"Chicken Road",blurb:"Cross lane after lane. Don't get hit."}];
const money=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:n%100===0?0:2}).format(n/100);
const mult=(n:number)=>(Math.round(n*100)/100).toFixed(2)+"×";
const PLINKO=[16,4,2,1,.5,1,2,4,16].map(w=>w*.98*256/355);
const rank=(c:number)=>c===11?"J":c===12?"Q":c===13?"K":c===14?"A":String(c);
const done=(g:GameView)=>g.status!=="active";
const key=(u:string)=>"ssg-games-v1:"+u;

// Ambiguous replies may already have committed. Replay the exact receipt once, never a new wager.
async function reply(body:string,stale:()=>boolean){
 for(let attempt=0;attempt<2;attempt++){
  let r:Response,d:any=null;
  try{
   r=await fetch("/api/games",{method:"POST",headers:{"Content-Type":"application/json",...getTabHeaders()},body});
   try{d=await r.json();}catch{}
  }catch(e){if(stale()||attempt===1)throw e;continue;}
  if(stale())return null;
  const valid=r.ok&&d&&Array.isArray(d.games)&&Number.isFinite(d.version)&&Number.isFinite(d.wallet);
  const ambiguous=r.status>=500||r.status===408||(r.ok&&!valid);
  if(ambiguous&&attempt===0)continue;
  return {r,d,valid};
 }
 return null;
}

export default function GamesClient(){
 const {user}=useUser(),uid=user?.id;
 const {connection}=useLive();
 const [snap,setSnap]=useState<Snapshot|null>(null),[kind,setKind]=useState<Kind>("plinko"),[error,setError]=useState(""),[working,setWorking]=useState(false),[pending,setPending]=useState<Pending|null>(null);
 // Keep the owner alongside the preference so a new account never renders the previous choice.
 const [minePreference,setMinePreference]=useState<{uid:string;count:number}|null>(null);
 const mines=minePreference&&minePreference.uid===uid?minePreference.count:3;
 useEffect(()=>{if(!uid){setMinePreference(null);return;}let count=3;try{const saved=Number(localStorage.getItem("ssg-games-mines-v1:"+uid));if(Number.isInteger(saved)&&saved>=1&&saved<=10)count=saved;}catch{}setMinePreference({uid,count});},[uid]);
 const setMines=(count:number)=>{if(!uid||!Number.isInteger(count)||count<1||count>10)return;setMinePreference({uid,count});try{localStorage.setItem("ssg-games-mines-v1:"+uid,String(count));}catch{}};
 const [animId,setAnimId]=useState<string|null>(null),[amount,setAmount]=useState("5");
 const [drops,setDropsState]=useState<Drop[]>([]),[balls,setBalls]=useState<Ball[]>([]),[results,setResults]=useState<GameView[]>([]),[plinkoError,setPlinkoError]=useState("");
 const dropsRef=useRef<Drop[]>([]),fetching=useRef(new Set<string>());
 const uidRef=useRef(uid);uidRef.current=uid;
 const epoch=useRef(0);
 const offset=useRef(0),working_=useRef(false),pendingRef=useRef<Pending|null>(null);
 const apply=useCallback((s:Snapshot)=>{offset.current=s.serverNow-Date.now();setSnap(cur=>cur&&cur.version>s.version?cur:s);},[]);
 const setP=useCallback((p:Pending|null)=>{pendingRef.current=p;setPending(p);if(!uid)return;try{if(p)sessionStorage.setItem(key(uid),JSON.stringify(p));else sessionStorage.removeItem(key(uid));}catch{}},[uid]);
 const setDrops=useCallback((fn:(d:Drop[])=>Drop[])=>{
  const next=fn(dropsRef.current);dropsRef.current=next;setDropsState(next);
  if(!uid)return;try{if(next.length)sessionStorage.setItem(dkey(uid),JSON.stringify(next.map(d=>({rid:d.rid,body:d.body,label:d.label}))));else sessionStorage.removeItem(dkey(uid));}catch{}
 },[uid]);
 const load=useCallback(async()=>{
  const who=uidRef.current,gen=epoch.current;try{const r=await fetch("/api/games",{cache:"no-store",headers:getTabHeaders()});const d=await r.json();if(!r.ok)throw new Error(d.error||"Could not load games.");if(uidRef.current!==who||epoch.current!==gen)return;apply(d as Snapshot);setError(e=>e==="Could not load games."?"":e);}catch(e){if(uidRef.current===who&&epoch.current===gen)setError(e instanceof Error?e.message:"Could not load games.");}
 },[apply]);
 // Restore an unresolved request after reload so Retry replays the identical envelope.
 useEffect(()=>{epoch.current++;working_.current=false;setWorking(false);pendingRef.current=null;setPending(null);setSnap(null);setError("");setAnimId(null);if(!uid)return;try{const raw=sessionStorage.getItem(key(uid));if(raw){const p=JSON.parse(raw) as Pending;if(p&&typeof p.body==="string"){pendingRef.current=p;setPending(p);}}}catch{}},[uid]);
 // Restore unconfirmed Plinko drops; each keeps its own requestId so Retry replays the same envelope.
 useEffect(()=>{dropsRef.current=[];fetching.current.clear();setDropsState([]);setBalls([]);setResults([]);setPlinkoError("");if(!uid)return;try{const raw=sessionStorage.getItem(dkey(uid));if(raw){const l=(JSON.parse(raw) as Drop[]).filter(p=>p&&typeof p.rid==="string"&&typeof p.body==="string").slice(0,MAX_DROPS).map(p=>({rid:p.rid,body:p.body,label:p.label||"Drop",state:"sending" as const}));if(l.length){dropsRef.current=l;setDropsState(l);}}}catch{}},[uid]);
 useEffect(()=>{if(connection==="connected"&&!working_.current&&!pendingRef.current)void load();},[connection,load,uid]);
 useEffect(()=>{
  const on=()=>{if(document.visibilityState==="visible"&&!working_.current&&!pendingRef.current)void load();};
  document.addEventListener("visibilitychange",on);window.addEventListener("focus",on);
  return()=>{document.removeEventListener("visibilitychange",on);window.removeEventListener("focus",on);};
 },[load]);
 const run=useCallback(async(p:Pending,fromRetry=false)=>{
  if(working_.current)return;const who=uidRef.current,gen=epoch.current;const stale=()=>uidRef.current!==who||epoch.current!==gen;working_.current=true;setWorking(true);setError("");
  if(!fromRetry)setP(p);
  try{
   const result=await reply(p.body,stale);if(!result||stale())return;
   const {r,d,valid}=result;
   if(valid){
    // Acknowledged: clear pending + storage first, so nothing after this can leave a false "unconfirmed" state.
    setP(null);setError("");apply(d as Snapshot);
    try{const body=JSON.parse(p.body),gs=(d as Snapshot).games;const g=body.type==="start"?gs.find(x=>x.id===(typeof d.actionGameId==="string"?d.actionGameId:body.requestId))||gs.filter(y=>y.kind===body.game).sort((a,b)=>b.createdAt-a.createdAt)[0]:gs.find(x=>x.id===body.id);if(g)setAnimId(g.id+":"+g.revision);}catch{}
   }
   else if(r.status>=400&&r.status<500&&r.status!==408&&r.status!==429){setP(null);setError(d?.error||"That didn't go through.");void load();}
   else setError(d?.error||"No confirmed reply. Retry to settle it safely.");
  }catch{if(!stale())setError("No confirmed reply. Retry to settle it safely.");}
  finally{if(!stale()){working_.current=false;setWorking(false);}}
 },[apply,load,setP]);
 const runDrop=useCallback(async(rid:string)=>{
  const p=dropsRef.current.find(d=>d.rid===rid),who=uidRef.current,gen=epoch.current;if(!p||!who||fetching.current.has(rid))return;
  const stale=()=>uidRef.current!==who||epoch.current!==gen;
  fetching.current.add(rid);setPlinkoError("");
  setDrops(l=>l.map(d=>d.rid===rid?{...d,state:"sending"}:d));
  try{
   const result=await reply(p.body,stale);if(!result||stale())return;
   const {r,d,valid}=result;
   if(valid){
    const s=d as Snapshot,id:string=typeof d.actionGameId==="string"?d.actionGameId:rid;
    // actionGameId may be null (old replay or pruned result): acknowledge safely, never place a replacement wager.
    // Out-of-order replies: the snapshot only moves forward, but this wager's own result is always kept.
    apply(s);const g=s.games.find(x=>x.id===id)||s.games.find(x=>x.id===rid);
    setDrops(l=>l.filter(x=>x.rid!==rid));
    if(g)setBalls(b=>b.some(x=>x.id===g.id)?b:[...b,{id:g.id,game:g}]);
   }else if(stale())return;
   else if(r.status>=400&&r.status<500&&r.status!==408&&r.status!==429){
    setDrops(l=>l.filter(x=>x.rid!==rid));setPlinkoError(d?.error||"That drop didn't go through.");void load();
   }else{setDrops(l=>l.map(x=>x.rid===rid?{...x,state:"unconfirmed"}:x));setPlinkoError(d?.error||"No confirmed reply. Retry that drop to settle it safely.");}
  }catch{if(!stale()){setDrops(l=>l.map(x=>x.rid===rid?{...x,state:"unconfirmed"}:x));setPlinkoError("No confirmed reply. Retry that drop to settle it safely.");}}
  finally{if(!stale())fetching.current.delete(rid);}
 },[apply,load,setDrops]);
 // Restoration reconciles automatically once connected, without flashing a false warning.
 const reconciled=useRef<number>(-1);
 useEffect(()=>{
  if(!uid||connection!=="connected"||reconciled.current===epoch.current)return;
  reconciled.current=epoch.current;
  if(pendingRef.current)void run(pendingRef.current,true);
  for(const d of dropsRef.current)void runDrop(d.rid);
 },[uid,connection,run,runDrop]);
 const drop=(amount:number)=>{
  if(dropsRef.current.length>=MAX_DROPS||amount>(snap?.wallet??0)-reserved(dropsRef.current))return;
  const rid=crypto.randomUUID();
  setDrops(l=>[...l,{rid,label:"Drop",state:"sending",body:JSON.stringify({type:"start",game:"plinko",amount,requestId:rid,requestAt:Date.now()+offset.current})}]);
  void runDrop(rid);
 };
 const ballDone=useCallback((g:GameView)=>{setBalls(b=>b.filter(x=>x.id!==g.id));setResults(r=>[g,...r.filter(x=>x.id!==g.id)].slice(0,12));},[]);
 const send=(label:string,payload:object)=>{if(pendingRef.current||working_.current)return;void run({label,body:JSON.stringify({...payload,requestId:crypto.randomUUID(),requestAt:Date.now()+offset.current})});};
 const byKind=useMemo(()=>{const m=new Map<Kind,GameView>();for(const g of snap?.games||[]){const c=m.get(g.kind);if(!c||(c.status!=="active"&&(g.status==="active"||g.createdAt>c.createdAt)))m.set(g.kind,g);}return m;},[snap]);
 const game=byKind.get(kind),active=game&&game.status==="active"?game:undefined;
 const blocked=connection!=="connected"||working||!!pending||!snap;
 const dropBlocked=connection!=="connected"||!snap||drops.length>=MAX_DROPS;
 const free=(snap?.wallet??0)-reserved(drops);
 const trail=useMemo(()=>{const seen=new Set<string>(),out:GameView[]=[];for(const g of [...results,...(snap?.games||[]).filter(g=>g.kind==="plinko"&&g.status!=="active").sort((a,b)=>b.createdAt-a.createdAt)]){if(seen.has(g.id)||balls.some(b=>b.id===g.id))continue;seen.add(g.id);out.push(g);}return out.slice(0,8);},[results,snap,balls]);
 const cents=casinoInputCents(amount),maxBet=snap?.maxBet??0;
 const betOk=cents!==null&&cents>0&&cents<=maxBet&&cents<=(snap?.wallet??0);
 const busy=!snap||connection!=="connected"||working||!!pending||(kind==="plinko"&&(drops.length>0||balls.length>0));
 const betProps={mines,setMines,amount,setAmount,cents,betOk:betOk&&(kind!=="plinko"||cents!<=free),maxBet};
 return <main className={styles.games}>
  <header className={styles.head}><div><h1>Games</h1><p>{Math.round((snap?.houseEdge??0.02)*100)}% house edge, payouts round down to the cent.</p></div><div className={styles.wallet}><span>Wallet</span><strong>{snap?money(snap.wallet):"—"}</strong></div></header>
  <div className={styles.tabs} role="tablist" aria-label="Games">{KINDS.map(k=>{const a=byKind.get(k.kind)?.status==="active";return <button key={k.kind} role="tab" aria-selected={kind===k.kind} className={styles.tab} onClick={()=>setKind(k.kind)}>{k.label}{a?<i className={styles.dot} aria-label="In progress"/>:null}</button>;})}</div>
  <p className={styles.blurb}>{KINDS.find(k=>k.kind===kind)!.blurb}</p>
  {kind!=="plinko"&&pending&&!working?<div className={styles.note+" "+styles.warn} role="alert"><span>{error||"Your last action is unconfirmed."} ({pending.label})</span><button className="primary" disabled={working||connection!=="connected"} onClick={()=>void run(pending,true)}>Retry</button></div>:kind!=="plinko"&&error?<p className={styles.note+" "+styles.warn} role="alert">{error}</p>:null}
  {kind==="plinko"&&plinkoError?<p className={styles.note+" "+styles.warn} role="alert">{plinkoError}</p>:null}
  <section className={styles.stage} key={kind} aria-label={KINDS.find(k=>k.kind===kind)!.label} aria-busy={busy}>
   {busy?<span className={styles.gameSpinner} role="status" aria-label="Game in progress"/>:null}
   {kind==="plinko"?<Plinko balls={balls} drops={drops} trail={trail} onDone={ballDone} onRetry={runDrop} blocked={connection!=="connected"}/>:null}
   {kind==="hilo"?<HiLo game={game} blocked={blocked} send={send}/>:null}
   {kind==="mines"?<Mines game={game} nextMines={mines} blocked={blocked} send={send}/>:null}
   {kind==="dice"?<DiceView game={game} animKey={animId}/>:null}
   {kind==="chicken"?<Chicken game={game} blocked={blocked} send={send} animKey={animId}/>:null}
   <p className={styles.outcome+" "+(game?.status==="lost"?styles.lose:styles.win)} role="status" aria-label="Round result">{game&&done(game)&&kind!=="plinko"?(game.status==="lost"?"Lost "+money(game.bet):(game.status==="cashed"?"Cashed out ":"Won ")+money(game.payout)+" at "+mult(game.multiplier)):kind==="plinko"&&trail[0]?(trail[0].status==="lost"?"Lost ":"Payout ")+money(trail[0].payout):" "}</p>
  </section>
  {kind==="plinko"?<StartPanel kind={kind} blocked={dropBlocked} send={send} drop={drop} {...betProps}/>:active?<ActiveBar game={active} blocked={blocked} send={send}/>:<StartPanel kind={kind} blocked={blocked} send={send} {...betProps}/>}
 </main>;
}
type Send=(label:string,payload:object)=>void;
function ActiveBar({game,blocked,send}:{game:GameView;blocked:boolean;send:Send}){
 const can=game.steps>=1;
 return <div className={styles.panel}><div className={styles.stat}><span>Bet</span><strong>{money(game.bet)}</strong></div><div className={styles.stat}><span>Multiplier</span><strong>{mult(game.multiplier)}</strong></div><div className={styles.stat}><span>Cash out</span><strong>{money(game.payout)}</strong></div>
  <button className={"primary "+styles.go} disabled={blocked||!can} onClick={()=>send("Cash out",{type:"cashout",id:game.id,revision:game.revision})}>{can?"Cash out":"Take a step first"}</button></div>;
}
function StartPanel({kind,blocked,send,drop,mines,setMines,amount,setAmount,cents,betOk,maxBet}:{mines:number;setMines:(n:number)=>void;drop?:(amount:number)=>void;kind:Kind;blocked:boolean;send:Send;amount:string;setAmount:(v:string)=>void;cents:number|null;betOk:boolean;maxBet:number}){
 const [target,setTarget]=useState(50),[dir,setDir]=useState<"over"|"under">("over");
 const extra:object=kind==="mines"?{mines}:kind==="dice"?{target,direction:dir}:{};
 const chance=dir==="over"?100-target:target-1;
 return <div className={styles.panel}>
  <label className={styles.field}><span>Bet</span><div className="input-wrap"><span>$</span><CasinoAmountInput aria-label="Bet in dollars" min="1" value={amount} onChange={setAmount}/></div></label>
  <div className={styles.quick} role="group" aria-label="Quick bets">{[1,5,25,100].map(n=><button key={n} disabled={blocked} onClick={()=>setAmount(String(n))}>{n}</button>)}</div>
  {kind==="mines"?<label className={styles.field}><span>Next bet · {mines} mines</span><input type="range" min={1} max={10} value={mines} onChange={e=>setMines(Number(e.target.value))} aria-label="Number of mines"/></label>:null}
  {kind==="dice"?<><div className={styles.seg} role="group" aria-label="Direction">{(["over","under"] as const).map(d=><button key={d} aria-pressed={dir===d} onClick={()=>setDir(d)}>Roll {d}</button>)}</div>
   <label className={styles.field}><span>Target {target} · about {chance}% to win · ≈{(98/chance).toFixed(2)}×</span><input type="range" min={2} max={98} value={target} onChange={e=>setTarget(Number(e.target.value))} aria-label="Target number"/></label></>:null}
  <button className={"primary "+styles.go} disabled={blocked||!betOk} onClick={()=>kind==="plinko"&&drop?drop(cents!):send("Start "+kind,{type:"start",game:kind,amount:cents,...extra})}>{kind==="dice"?"Roll":kind==="plinko"?"Drop":"Start"}</button>
  {cents!==null&&cents>maxBet?<small className={styles.hint}>Max bet is {money(maxBet)}.</small>:null}
 </div>;
}
function PlinkoBall({game,onDone}:{game:GameView;onDone:(g:GameView)=>void}){
 const el=useRef<HTMLSpanElement>(null),done_=useRef(onDone);done_.current=onDone;
 const path=game.result?.path;
 useEffect(()=>{
  const e=el.current;if(!e||!path){done_.current(game);return;}
  let x=0;const frames=[{left:"50%",top:"-4%"}];
  path.forEach((b,i)=>{x+=b?1:0;frames.push({left:50+(x-(i+1)/2)*(100/9)+"%",top:(i+1)*(88/path.length)+"%"});});
  if(matchMedia("(prefers-reduced-motion: reduce)").matches){done_.current(game);return;}
  const an=e.animate(frames,{duration:path.length*260,easing:"cubic-bezier(.3,.1,.5,1)",fill:"forwards"});
  an.onfinish=()=>done_.current(game);
  return()=>an.cancel();
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 return <span ref={el} className={styles.ball}/>;
}
function Plinko({balls,drops,trail,onDone,onRetry,blocked}:{balls:Ball[];drops:Drop[];trail:GameView[];onDone:(g:GameView)=>void;onRetry:(rid:string)=>void;blocked:boolean}){
 const rows=8,last=trail[0],slot=last?.result?.slot;
 const [flash,setFlash]=useState<number|null>(null);
 useEffect(()=>{if(slot===undefined||!last)return;setFlash(slot);const t=setTimeout(()=>setFlash(null),900);return()=>clearTimeout(t);},[last?.id,slot]);
 const idle=!balls.length&&!drops.length&&!trail.length;
 const unconfirmed=drops.filter(d=>d.state==="unconfirmed");
 return <div>
  <div className={styles.plinko} role="img" aria-label={last?"Last ball landed in slot "+((slot??0)+1)+", "+mult(PLINKO[slot??0]):"Plinko board"}>
   {Array.from({length:rows},(_,r)=>Array.from({length:r+1},(_,c)=><i key={r+"-"+c} className={styles.peg} style={{left:50+(c-r/2)*(100/9)+"%",top:(r+1)*(88/rows)-4+"%"}}/>))}
   {balls.map(b=><PlinkoBall key={b.id} game={b.game} onDone={onDone}/>)}
   <div className={styles.slots}>{Array.from({length:rows+1},(_,i)=><b key={i} className={flash===i?styles.hit:""} aria-label={"Slot "+(i+1)+", "+mult(PLINKO[i])}>{PLINKO[i].toFixed(2)}×</b>)}</div>
   {idle?<p className={styles.empty}>Place a bet and drop the ball. You can drop several at once.</p>:null}
  </div>
  {unconfirmed.length?<ul className={styles.drops} aria-label="Drops awaiting a result">{unconfirmed.map(d=><li key={d.rid} className={styles.warn}><span>Unconfirmed</span><button disabled={blocked} onClick={()=>onRetry(d.rid)}>Retry</button></li>)}</ul>:null}
  {trail.length?<ul className={styles.trail} aria-label="Recent drops">{trail.map(g=>{const win=g.payout>=g.bet;return <li key={g.id} className={win?styles.win:styles.lose}><b>{mult(g.multiplier)}</b><span>{win?"+":"-"}{money(Math.abs(g.payout-g.bet))}</span></li>;})}</ul>:null}
 </div>;
}
function HiLo({game,blocked,send}:{game?:GameView;blocked:boolean;send:Send}){
 const cards=game?.cards||(game?.card?[game.card]:[]),act=game?.status==="active",lostNow=game?.status==="lost";
 return <div className={styles.hilo}>
  <div className={styles.cards}>{cards.map((c,i)=><span key={i} className={styles.card+(i===cards.length-1?" "+styles.fresh+(lostNow?" "+styles.bad:""):"")}>{rank(c)}</span>)}{!cards.length?<span className={styles.card+" "+styles.back}>?</span>:null}</div>
  <p className={styles.rule}>Ace is high, 2 is low. Ties lose. Auto cash-out after 6 correct guesses.</p>{act&&game?<div className={styles.choices}><button disabled={blocked||game.card===14} onClick={()=>send("Higher",{type:"step",id:game.id,revision:game.revision,choice:"high"})}>Higher ↑</button><button disabled={blocked||game.card===2} onClick={()=>send("Lower",{type:"step",id:game.id,revision:game.revision,choice:"low"})}>Lower ↓</button></div>:<p className={styles.empty}>{game?"Round over.":"Start to draw your first card."}</p>}
 </div>;
}
function Mines({game,nextMines,blocked,send}:{game?:GameView;nextMines:number;blocked:boolean;send:Send}){
 const rev=new Set(game?.revealed||[]),act=game?.status==="active",hit=game?.status==="lost"?game.result?.hit:undefined;
 const bombs=new Set(game?.status==="lost"?game.bombs||[hit]:[]);
 return <div><div className={styles.minesInfo}>{game?.mines?<span>{act?"Current round":"Finished round"} · {game.mines} mines · {rev.size} safe</span>:<span>Next bet · {nextMines} mines · 5 × 5 grid</span>}</div>
  <div className={styles.grid}>{Array.from({length:25},(_,i)=>{const safe=rev.has(i),bomb=bombs.has(i);return <button key={i} aria-label={"Cell "+(i+1)+(safe?", safe":bomb?(hit===i?", mine, hit":", mine"):"")} disabled={!act||blocked||safe||!game} className={styles.cell+(safe?" "+styles.safe:"")+(bomb?" "+styles.mine:"")+(hit===i?" "+styles.boom:"")} onClick={()=>game&&send("Reveal cell",{type:"step",id:game.id,revision:game.revision,cell:i})}>{safe?<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3l7 7-7 11L5 10z" fill="currentColor"/></svg>:bomb?<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="11" cy="14" r="7" fill="currentColor"/><path d="M15 8l3-3M18 3v3M16 5h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>:null}</button>;})}</div></div>;
}
function DiceView({game,animKey}:{game?:GameView;animKey:string|null}){
 const roll=game?.result?.roll,play=!!game&&animKey===game.id+":"+game.revision;
 const [shown,setShown]=useState<number|null>(null);
 useEffect(()=>{
  if(roll===undefined){setShown(null);return;}
  if(!play||matchMedia("(prefers-reduced-motion: reduce)").matches){setShown(roll);return;}
  let n=0;const t=setInterval(()=>{n++;if(n>=10){clearInterval(t);setShown(roll);}else setShown(Math.floor(Math.random()*100)+1);},60);
  return()=>clearInterval(t);
 },[roll,play]);
 const target=game?.target,over=game?.direction==="over";
 return <div className={styles.dice}><div className={styles.rollNum+(shown!==null&&shown===roll?" "+(game?.status==="lost"?styles.lose:styles.win):"")}>{shown??"–"}</div>
  {target?<div className={styles.bar} aria-hidden="true"><i className={styles.zone+" "+(over?styles.over:styles.under)} style={over?{left:target+"%",right:0}:{left:0,width:target+"%"}}/>{shown!==null?<b className={styles.marker} style={{left:shown+"%"}}/>:null}</div>:null}
  <p className={styles.empty}>{target?"Roll "+game?.direction+" "+target:"Choose a target and roll."}</p></div>;
}
const CHICKEN_LANES=10,chickenMult=(n:number)=>0.98*Math.pow(1.25,n);
function ChickenSvg({dead}:{dead:boolean}){return <svg viewBox="0 0 32 32" width="1em" height="1em" aria-hidden="true"><ellipse cx="14" cy="19" rx="10" ry="8" fill={dead?"currentColor":"#f5f5f7"} stroke="currentColor" strokeWidth="2"/><circle cx="22" cy="10" r="5" fill={dead?"currentColor":"#f5f5f7"} stroke="currentColor" strokeWidth="2"/><path d="M27 10l4 2-4 2z" fill="#f5a623"/><path d="M21 4c1-2 3-2 3 0" stroke="#ff3b30" strokeWidth="2" fill="none"/><circle cx="23" cy="9" r="1" fill="#000"/></svg>;}
function Chicken({game,blocked,send,animKey}:{game?:GameView;blocked:boolean;send:Send;animKey:string|null}){
 const lanes=CHICKEN_LANES,act=game?.status==="active",lost=game?.status==="lost",won=game?.status==="won"||game?.status==="cashed";
 const crashLane=lost?(game?.result?.hit??game?.steps??1):0;
 const steps=Math.max(0,(game?.steps??0)-(lost?1:0));
 const play=!!game&&animKey===game.id+":"+game.revision;
 const pos=lost?crashLane:steps;
 const next=chickenMult(steps+1);
 const full=steps>=lanes;
 return <div className={styles.road}>
  <p className={styles.rule}>Each lane is a 1 in 5 risk. Auto cash-out after crossing all 10.</p>
  <div className={styles.roadStats} aria-live="polite">
   <div><span>Lane</span><strong>{game?Math.min(steps,lanes)+" / "+lanes:"0 / "+lanes}</strong></div>
   <div><span>{act&&!full?"Next lane":"Multiplier"}</span><strong>{mult(act&&!full?next:game?game.multiplier:chickenMult(1))}</strong></div>
   <div><span>{lost?"Lost":"Safe payout"}</span><strong className={lost?styles.lose:""}>{game?money(lost?game.bet:game.payout):"—"}</strong></div>
  </div>
  <div className={styles.lanes}>
   <span className={styles.curb} aria-hidden="true">Start</span>
   {Array.from({length:lanes},(_,i)=>{const n=i+1,crash=lost&&n===crashLane,passed=n<=steps,cur=act&&n===steps+1;
    return <span key={i} className={styles.lane+(passed?" "+styles.passed:"")+(crash?" "+styles.crash:"")+(cur?" "+styles.cur:"")} aria-label={"Lane "+n+(passed?", crossed":crash?", hit by a car":cur?", next":"")+", "+mult(chickenMult(n))}>
     <i className={styles.dash} aria-hidden="true"/>
     {crash?<svg className={styles.car} viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="8" width="22" height="18" rx="5" fill="currentColor"/><rect x="9" y="11" width="14" height="6" rx="2" fill="#fff" opacity=".7"/></svg>:null}
     <small>{passed?"✓":mult(chickenMult(n))}</small>
    </span>;})}
   <span className={styles.chick+(lost?" "+styles.dead:"")+(won?" "+styles.safeEnd:"")+(play?" "+styles.hop:"")} style={{left:"calc("+pos/(lanes+1)*100+"% + 4px)"}} aria-label="Chicken"><ChickenSvg dead={lost}/></span>
  </div>
  {act&&game?<div className={styles.choices}>
   <button className="primary" disabled={blocked||full} onClick={()=>send("Cross lane",{type:"step",id:game.id,revision:game.revision})}>Cross next lane</button>
   <button disabled={blocked||game.steps<1} onClick={()=>send("Cash out",{type:"cashout",id:game.id,revision:game.revision})}>{game.steps>=1?"Cash out "+money(game.payout):"Cash out"}</button>
  </div>:<p className={styles.empty}>{game?(lost?"The chicken didn't make it.":"Round over."):"Start to step onto the road."}</p>}
 </div>;
}
