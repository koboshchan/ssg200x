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
type GameView={id:string;kind:Kind;bet:number;status:Status;revision:number;steps:number;multiplier:number;payout:number;createdAt:number;card?:number;cards?:number[];revealed?:number[];mines?:number;result?:{path?:number[];slot?:number;roll?:number;hit?:number;card?:number};target?:number;direction?:"over"|"under"};
type Snapshot={version:number;wallet:number;maxBet:number;serverNow:number;games:GameView[];houseEdge:number};
type Pending={body:string;label:string};
const KINDS:{kind:Kind;label:string;blurb:string}[]=[{kind:"plinko",label:"Plinko",blurb:"Drop the ball, land a multiplier."},{kind:"hilo",label:"Hi-Lo",blurb:"Guess higher or lower, cash out any time."},{kind:"mines",label:"Mines",blurb:"Reveal gems, avoid the mines."},{kind:"dice",label:"Dice",blurb:"Roll over or under your target."},{kind:"chicken",label:"Chicken Road",blurb:"Cross lane after lane. Don't get hit."}];
const money=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:n%100===0?0:2}).format(n/100);
const mult=(n:number)=>(Math.round(n*100)/100).toFixed(2)+"×";
const PLINKO=[16,4,2,1,.5,1,2,4,16].map(w=>w*.98*256/355);
const rank=(c:number)=>c===11?"J":c===12?"Q":c===13?"K":c===14?"A":String(c);
const done=(g:GameView)=>g.status!=="active";
const key=(u:string)=>"ssg-games-v1:"+u;

export default function GamesClient(){
 const {user}=useUser(),uid=user?.id;
 const {connection}=useLive();
 const [snap,setSnap]=useState<Snapshot|null>(null),[kind,setKind]=useState<Kind>("plinko"),[error,setError]=useState(""),[working,setWorking]=useState(false),[pending,setPending]=useState<Pending|null>(null);
 const [animId,setAnimId]=useState<string|null>(null),[amount,setAmount]=useState("5");
 const offset=useRef(0),working_=useRef(false),pendingRef=useRef<Pending|null>(null);
 const apply=useCallback((s:Snapshot)=>{offset.current=s.serverNow-Date.now();setSnap(cur=>cur&&cur.version>s.version?cur:s);},[]);
 const setP=useCallback((p:Pending|null)=>{pendingRef.current=p;setPending(p);if(!uid)return;try{if(p)sessionStorage.setItem(key(uid),JSON.stringify(p));else sessionStorage.removeItem(key(uid));}catch{}},[uid]);
 const load=useCallback(async()=>{
  try{const r=await fetch("/api/games",{cache:"no-store",headers:getTabHeaders()});const d=await r.json();if(!r.ok)throw new Error(d.error||"Could not load games.");apply(d as Snapshot);setError(e=>e==="Could not load games."?"":e);}catch(e){setError(e instanceof Error?e.message:"Could not load games.");}
 },[apply]);
 // Restore an unresolved request after reload so Retry replays the identical envelope.
 useEffect(()=>{if(!uid)return;try{const raw=sessionStorage.getItem(key(uid));if(raw){const p=JSON.parse(raw) as Pending;if(p&&typeof p.body==="string"){pendingRef.current=p;setPending(p);}}}catch{}},[uid]);
 useEffect(()=>{if(connection==="connected"&&!working_.current&&!pendingRef.current)void load();},[connection,load]);
 useEffect(()=>{
  const on=()=>{if(document.visibilityState==="visible"&&!working_.current&&!pendingRef.current)void load();};
  document.addEventListener("visibilitychange",on);window.addEventListener("focus",on);
  return()=>{document.removeEventListener("visibilitychange",on);window.removeEventListener("focus",on);};
 },[load]);
 const run=useCallback(async(p:Pending,fromRetry=false)=>{
  if(working_.current)return;working_.current=true;setWorking(true);setError("");
  if(!fromRetry)setP(p);
  try{
   const r=await fetch("/api/games",{method:"POST",headers:{"Content-Type":"application/json",...getTabHeaders()},body:p.body});
   let d:any=null;try{d=await r.json();}catch{}
   if(r.ok&&d){const body=JSON.parse(p.body);apply(d as Snapshot);setP(null);const g=(d as Snapshot).games.find(x=>body.type==="start"?x.kind===body.game&&x.createdAt===Math.max(...(d as Snapshot).games.filter(y=>y.kind===body.game).map(y=>y.createdAt)):x.id===body.id);if(g)setAnimId(g.id+":"+g.revision);}
   else if(r.status>=400&&r.status<500&&r.status!==408&&r.status!==425&&r.status!==429){setP(null);setError(d?.error||"That didn't go through.");void load();}
   else setError(d?.error||"No confirmed reply. Retry to settle it safely.");
  }catch{setError("No confirmed reply. Retry to settle it safely.");}
  finally{working_.current=false;setWorking(false);}
 },[apply,load,setP]);
 const send=(label:string,payload:object)=>{if(pendingRef.current||working_.current)return;void run({label,body:JSON.stringify({...payload,requestId:crypto.randomUUID(),requestAt:Date.now()+offset.current})});};
 const byKind=useMemo(()=>{const m=new Map<Kind,GameView>();for(const g of snap?.games||[]){const c=m.get(g.kind);if(!c||(c.status!=="active"&&(g.status==="active"||g.createdAt>c.createdAt)))m.set(g.kind,g);}return m;},[snap]);
 const game=byKind.get(kind),active=game&&game.status==="active"?game:undefined;
 const blocked=connection!=="connected"||working||!!pending||!snap;
 const cents=casinoInputCents(amount),maxBet=snap?.maxBet??0;
 const betOk=cents!==null&&cents>0&&cents<=maxBet&&cents<=(snap?.wallet??0);
 const betProps={amount,setAmount,cents,betOk,maxBet};
 return <main className={styles.games}>
  <header className={styles.head}><div><h1>Games</h1><p>{Math.round((snap?.houseEdge??0.02)*100)}% house edge, payouts round down to the cent.</p></div><div className={styles.wallet}><span>Wallet</span><strong>{snap?money(snap.wallet):"—"}</strong></div></header>
  <div className={styles.tabs} role="tablist" aria-label="Games">{KINDS.map(k=>{const a=byKind.get(k.kind)?.status==="active";return <button key={k.kind} role="tab" aria-selected={kind===k.kind} className={styles.tab} onClick={()=>setKind(k.kind)}>{k.label}{a?<i className={styles.dot} aria-label="In progress"/>:null}</button>;})}</div>
  <p className={styles.blurb}>{KINDS.find(k=>k.kind===kind)!.blurb}</p>
  {connection!=="connected"?<p className={styles.note} role="status">Reconnecting. Games are paused until the connection returns.</p>:null}
  {pending?<div className={styles.note+" "+styles.warn} role="alert"><span>{error||"Your last action is unconfirmed."} ({pending.label})</span><button className="primary" disabled={working||connection!=="connected"} onClick={()=>void run(pending,true)}>{working?"Retrying…":"Retry"}</button></div>:error?<p className={styles.note+" "+styles.warn} role="alert">{error}</p>:null}
  <section className={styles.stage} key={kind} aria-label={KINDS.find(k=>k.kind===kind)!.label}>
   {kind==="plinko"?<Plinko game={game} animKey={animId} />:null}
   {kind==="hilo"?<HiLo game={game} blocked={blocked} send={send}/>:null}
   {kind==="mines"?<Mines game={game} blocked={blocked} send={send}/>:null}
   {kind==="dice"?<DiceView game={game} animKey={animId}/>:null}
   {kind==="chicken"?<Chicken game={game} blocked={blocked} send={send} animKey={animId}/>:null}
   {game&&done(game)?<p className={styles.outcome+" "+(game.status==="lost"?styles.lose:styles.win)} role="status">{game.status==="lost"?"Lost "+money(game.bet):(game.status==="cashed"?"Cashed out ":"Won ")+money(game.payout)+" at "+mult(game.multiplier)}</p>:null}
  </section>
  {active?<ActiveBar game={active} blocked={blocked} send={send}/>:<StartPanel kind={kind} blocked={blocked} send={send} {...betProps}/>}
 </main>;
}
type Send=(label:string,payload:object)=>void;
function ActiveBar({game,blocked,send}:{game:GameView;blocked:boolean;send:Send}){
 const can=game.steps>=1;
 return <div className={styles.panel}><div className={styles.stat}><span>Bet</span><strong>{money(game.bet)}</strong></div><div className={styles.stat}><span>Multiplier</span><strong>{mult(game.multiplier)}</strong></div><div className={styles.stat}><span>Cash out</span><strong>{money(game.payout)}</strong></div>
  <button className={"primary "+styles.go} disabled={blocked||!can} onClick={()=>send("Cash out",{type:"cashout",id:game.id,revision:game.revision})}>{can?"Cash out":"Take a step first"}</button></div>;
}
function StartPanel({kind,blocked,send,amount,setAmount,cents,betOk,maxBet}:{kind:Kind;blocked:boolean;send:Send;amount:string;setAmount:(v:string)=>void;cents:number|null;betOk:boolean;maxBet:number}){
 const [mines,setMines]=useState(3),[target,setTarget]=useState(50),[dir,setDir]=useState<"over"|"under">("over");
 const extra:object=kind==="mines"?{mines}:kind==="dice"?{target,direction:dir}:{};
 const chance=dir==="over"?100-target:target-1;
 return <div className={styles.panel}>
  <label className={styles.field}><span>Bet</span><div className="input-wrap"><span>$</span><CasinoAmountInput aria-label="Bet in dollars" min="1" value={amount} onChange={setAmount}/></div></label>
  <div className={styles.quick} role="group" aria-label="Quick bets">{[1,5,25,100].map(n=><button key={n} disabled={blocked} onClick={()=>setAmount(String(n))}>{n}</button>)}</div>
  {kind==="mines"?<label className={styles.field}><span>Mines {mines}</span><input type="range" min={1} max={10} value={mines} onChange={e=>setMines(Number(e.target.value))} aria-label="Number of mines"/></label>:null}
  {kind==="dice"?<><div className={styles.seg} role="group" aria-label="Direction">{(["over","under"] as const).map(d=><button key={d} aria-pressed={dir===d} onClick={()=>setDir(d)}>Roll {d}</button>)}</div>
   <label className={styles.field}><span>Target {target} · about {chance}% to win · ≈{(98/chance).toFixed(2)}×</span><input type="range" min={2} max={98} value={target} onChange={e=>setTarget(Number(e.target.value))} aria-label="Target number"/></label></>:null}
  <button className={"primary "+styles.go} disabled={blocked||!betOk} onClick={()=>send("Start "+kind,{type:"start",game:kind,amount:cents,...extra})}>{kind==="dice"?"Roll":kind==="plinko"?"Drop":"Start"}</button>
  {cents!==null&&cents>maxBet?<small className={styles.hint}>Max bet is {money(maxBet)}.</small>:null}
 </div>;
}
function Plinko({game,animKey}:{game?:GameView;animKey:string|null}){
 const ball=useRef<HTMLSpanElement>(null),path=game?.result?.path,slot=game?.result?.slot;
 const play=!!game&&animKey===game.id+":"+game.revision;
 useEffect(()=>{
  const el=ball.current;if(!el||!path)return;
  let x=0;const frames=[{left:"50%",top:"-4%"}];
  path.forEach((b,i)=>{x+=b?1:0;frames.push({left:50+(x-(i+1)/2)*(100/9)+"%",top:(i+1)*(88/path.length)+"%"});});
  const last=frames[frames.length-1];
  if(!play||matchMedia("(prefers-reduced-motion: reduce)").matches){el.style.left=last.left;el.style.top=last.top;return;}
  const a=el.animate(frames,{duration:path.length*260,easing:"cubic-bezier(.3,.1,.5,1)",fill:"forwards"});
  return()=>a.cancel();
 },[path,play]);
 const rows=8;
 return <div className={styles.plinko} role="img" aria-label={path?"Ball landed in slot "+((slot??0)+1)+", "+mult(PLINKO[slot??0]):"Plinko board"}>
  {Array.from({length:rows},(_,r)=>Array.from({length:r+1},(_,c)=><i key={r+"-"+c} className={styles.peg} style={{left:50+(c-r/2)*(100/9)+"%",top:(r+1)*(88/rows)-4+"%"}}/>))}
  {path?<span ref={ball} className={styles.ball}/>:null}
  <div className={styles.slots}>{Array.from({length:rows+1},(_,i)=><b key={i} className={slot===i?styles.hit:""} aria-label={"Slot "+(i+1)+", "+mult(PLINKO[i])}>{PLINKO[i].toFixed(2)}×</b>)}</div>
  {!game?<p className={styles.empty}>Place a bet and drop the ball.</p>:null}
 </div>;
}
function HiLo({game,blocked,send}:{game?:GameView;blocked:boolean;send:Send}){
 const cards=game?.cards||(game?.card?[game.card]:[]),act=game?.status==="active",lostNow=game?.status==="lost";
 return <div className={styles.hilo}>
  <div className={styles.cards}>{cards.map((c,i)=><span key={i} className={styles.card+(i===cards.length-1?" "+styles.fresh+(lostNow?" "+styles.bad:""):"")}>{rank(c)}</span>)}{!cards.length?<span className={styles.card+" "+styles.back}>?</span>:null}</div>
  <p className={styles.rule}>Ace is high, 2 is low. Ties lose. Auto cash-out after 6 correct guesses.</p>{act&&game?<div className={styles.choices}><button disabled={blocked||game.card===14} onClick={()=>send("Higher",{type:"step",id:game.id,revision:game.revision,choice:"high"})}>Higher ↑</button><button disabled={blocked||game.card===2} onClick={()=>send("Lower",{type:"step",id:game.id,revision:game.revision,choice:"low"})}>Lower ↓</button></div>:<p className={styles.empty}>{game?"Round over.":"Start to draw your first card."}</p>}
 </div>;
}
function Mines({game,blocked,send}:{game?:GameView;blocked:boolean;send:Send}){
 const rev=new Set(game?.revealed||[]),act=game?.status==="active",hit=game?.result?.hit;
 return <div><div className={styles.minesInfo}>{game?.mines?<span>{game.mines} mines · {rev.size} safe</span>:<span>5 × 5 grid</span>}</div>
  <div className={styles.grid}>{Array.from({length:25},(_,i)=>{const safe=rev.has(i),bomb=hit===i;return <button key={i} aria-label={"Cell "+(i+1)+(safe?", safe":bomb?", mine":"")} disabled={!act||blocked||safe||!game} className={styles.cell+(safe?" "+styles.safe:"")+(bomb?" "+styles.boom:"")} onClick={()=>game&&send("Reveal cell",{type:"step",id:game.id,revision:game.revision,cell:i})}>{safe?<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3l7 7-7 11L5 10z" fill="currentColor"/></svg>:bomb?<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="11" cy="14" r="7" fill="currentColor"/><path d="M15 8l3-3M18 3v3M16 5h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>:null}</button>;})}</div></div>;
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
function Chicken({game,blocked,send,animKey}:{game?:GameView;blocked:boolean;send:Send;animKey:string|null}){
 const lanes=10,act=game?.status==="active",lost=game?.status==="lost",steps=Math.max(0,(game?.steps??0)-(lost?1:0));
 const play=!!game&&animKey===game.id+":"+game.revision;
 return <div className={styles.road}><p className={styles.rule}>Each lane is a 1 in 5 risk. Auto cash-out after crossing all 10.</p><div className={styles.lanes}>{Array.from({length:lanes},(_,i)=><span key={i} className={styles.lane+(i<steps?" "+styles.passed:"")+(lost&&i===steps?" "+styles.crash:"")}>{i+1}</span>)}
  <span className={styles.chick+(lost?" "+styles.dead:"")+(play?" "+styles.hop:"")} style={{left:"calc("+(steps+(lost?1:0))/(lanes+1)*100+"% + 4px)"}} aria-label="Chicken"><svg viewBox="0 0 32 32" width="1em" height="1em" aria-hidden="true"><ellipse cx="14" cy="19" rx="10" ry="8" fill={lost?"currentColor":"#f5f5f7"} stroke="currentColor" strokeWidth="2"/><circle cx="22" cy="10" r="5" fill={lost?"currentColor":"#f5f5f7"} stroke="currentColor" strokeWidth="2"/><path d="M27 10l4 2-4 2z" fill="#f5a623"/><path d="M21 4c1-2 3-2 3 0" stroke="#ff3b30" strokeWidth="2" fill="none"/><circle cx="23" cy="9" r="1" fill="#000"/></svg></span></div>
  {act&&game?<div className={styles.choices}><button className="primary" disabled={blocked||steps>=lanes} onClick={()=>send("Cross lane",{type:"step",id:game.id,revision:game.revision})}>Cross next lane</button></div>:<p className={styles.empty}>{game?"Round over.":"Start to step onto the road."}</p>}
 </div>;
}
