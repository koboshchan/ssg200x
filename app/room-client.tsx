"use client";
import dynamic from "next/dynamic";
const Markets=dynamic(()=>import("./finance-client").then(m=>m.Markets));
const Blackjack=dynamic(()=>import("./blackjack-client"));
const Roulette=dynamic(()=>import("./finance-client").then(m=>m.Roulette));
import {SignInButton,UserButton,useUser,useAuth} from "@clerk/nextjs";
import HistoryProgress from "./history-progress";
import {useState,useEffect,useCallback,useRef} from "react";
import type {PublicRoom} from "@/lib/public";
import type {Action} from "@/lib/types";
const money=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:n%100===0?0:2}).format(n/100);
const signed=(n:number)=>(n>=0?"+":"−")+money(Math.abs(n));
const suits:Record<string,string>={s:"♠",h:"♥",c:"♣",d:"♦"};
function Card({value,small=false}:{value:string;small?:boolean}){
 const back=value==="?";const red=!back&&["h","d"].includes(value.slice(-1));
 return <span aria-label={back?"Hidden card":value} className={"card"+(back?" back":"")+(red?" red":"")+(small?" small":"")}>{back?<span>♠</span>:<><b>{value[0]==="T"?"10":value[0]}</b><i>{suits[value.slice(-1)]}</i></>}</span>;
}
export default function RoomClient({configured}:{configured:boolean}){
 return configured?<Authenticated/>:<Shell><Landing setup/></Shell>;
}
function Authenticated(){
 const {isLoaded,isSignedIn}=useUser();
 return <Shell account={isSignedIn?<UserButton/>:undefined}>{!isLoaded?<p className="loading" role="status">Opening the room…</p>:isSignedIn?<Game/>:<Landing/>}</Shell>;
}
function Shell({children,account}:{children:React.ReactNode;account?:React.ReactNode}){
 return <><header className="mast"><a className="wordmark" href="/" aria-label="ssg200x home">ssg200x</a><div className="header-right"><span className="private-label">Private table</span>{account}</div></header>{children}<footer><span>ssg200x</span><span>Play money only · No deposits. No cash-outs. · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></span></footer></>;
}
function Landing({setup=false}:{setup?:boolean}){
 return <main className="landing"><section><h1>Poker with friends.</h1><p className="intro">No-limit hold’em with play money. Everyone starts with $1,000 and a seat at the table.</p>{setup?<p className="setup" role="status">The table is being set. Clerk keys are needed before sign-in opens.</p>:<SignInButton mode="modal"><button className="primary google"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.8 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.5a4.7 4.7 0 0 1-2 3.1v2.6h3.3c1.9-1.8 3-4.4 3-7.6ZM12 22c2.7 0 5-.9 6.7-2.5l-3.3-2.6c-.9.6-2.1.9-3.4.9-2.6 0-4.8-1.8-5.6-4.1H3v2.7A10 10 0 0 0 12 22ZM6.4 13.7a6 6 0 0 1 0-3.4V7.6H3a10 10 0 0 0 0 8.8l3.4-2.7ZM12 6.2c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.7 9.7 0 0 0 12 2a10 10 0 0 0-9 5.6l3.4 2.7A6 6 0 0 1 12 6.2Z"/></svg>Continue with Google</button></SignInButton>}<p className="fine">Invite-only. Lucas approves every player.</p></section></main>;
}

type Member={publicId:string;name:string;email:string;wallet?:number};
type AdminUser=PublicRoom["adminUsers"][number];
function Guest({m,u,self=false,pending=false,busy,post}:{m:Member;u?:AdminUser;self?:boolean;pending?:boolean;busy:boolean;post:(path:string,body:object)=>Promise<void>}){
 const [delta,setDelta]=useState(""),[confirm,setConfirm]=useState(false);
 const cents=Math.round(Number(delta)*100),valid=delta.trim()!==""&&Number.isFinite(cents)&&cents!==0&&Number.isSafeInteger(cents);
 const after=(m.wallet??0)+cents;
 async function submit(){await post("/api/admin",{type:"balance",publicId:m.publicId,delta:cents,requestId:crypto.randomUUID(),requestAt:Date.now()});setDelta("");setConfirm(false);}
 return <div className="guest guest-admin"><div><strong>{m.name}</strong><span>{m.email}</span>{typeof m.wallet==="number"?<span>Wallet {money(m.wallet)}{u?" · Net worth "+money(u.netWorth):""}</span>:null}</div>
  <div className="guest-actions">
   {pending?<><button disabled={busy} className="primary" onClick={()=>post("/api/admin",{publicId:m.publicId,approved:true})}>Approve</button><button disabled={busy} onClick={()=>post("/api/admin",{publicId:m.publicId,approved:false})}>Deny</button></>:<button disabled={busy} onClick={()=>post("/api/admin",{publicId:m.publicId,approved:false})}>Remove access</button>}
   <div className="adjust"><label><span className="sr-only">Balance change in dollars for {m.name}</span><div className="input-wrap"><span>$</span><input type="number" inputMode="decimal" step=".01" placeholder="+50 or -20" value={delta} onChange={e=>{setDelta(e.target.value);setConfirm(false);}}/></div></label>
    {confirm&&valid?<><span className="adjust-note" role="status">{cents>0?"Add ":"Remove "}{money(Math.abs(cents))}{typeof m.wallet==="number"?", new balance "+money(after):""}</span><button className="primary" disabled={busy||after<0} onClick={submit}>Confirm</button><button disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button></>:<button disabled={busy||!valid} onClick={()=>setConfirm(true)}>Adjust balance</button>}
    {confirm&&valid&&after<0?<span className="adjust-note negative">Balance can't go below $0.</span>:null}</div>
  </div>{u&&(u.holdings.length||u.positions.length)?<details className="holdings"><summary>{u.holdings.length} holdings · {u.positions.length} positions</summary>{u.holdings.length?<table><thead><tr><th>Asset</th><th>Quantity</th><th>Cost</th><th>Value</th></tr></thead><tbody>{u.holdings.map(h=><tr key={h.symbol}><th>{h.symbol}</th><td>{(h.units/1e8).toFixed(8)}</td><td>{money(h.cost)}</td><td>{money(h.value)}</td></tr>)}</tbody></table>:null}{u.positions.length?<table><thead><tr><th>Position</th><th>Margin</th><th>Entry</th><th>Liquidation</th><th>Equity</th><th>P/L</th></tr></thead><tbody>{u.positions.map(x=><tr key={x.id}><th>{x.symbol} {x.side} {x.leverage}x</th><td>{money(x.margin)}</td><td>{usd(x.entry)}</td><td>{usd(x.liquidation)}</td><td>{money(x.equity)}</td><td className={x.pnl>=0?"positive":"negative"}>{signed(x.pnl)}</td></tr>)}</tbody></table>:null}</details>:null}</div>;
}

type AdminPos={publicId:string;name:string;id:string;symbol:string;side:string;leverage:number;entry:number;liquidation:number};
type AdminRoom={maintenancePercent?:number;adminPositions?:AdminPos[]};
const usd=(micro:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:micro/1e6<1?6:2}).format(micro/1e6);
function RiskControls({room,busy,post}:{room:AdminRoom;busy:boolean;post:(path:string,body:object)=>Promise<void>}){
 const current=room.maintenancePercent??0,positions=room.adminPositions||[];
 const [pct,setPct]=useState(""),[askPct,setAskPct]=useState(false);
 const n=Number(pct),validPct=pct.trim()!==""&&Number.isFinite(n)&&n>=0&&n<=20;
 const meta=()=>({requestId:crypto.randomUUID(),requestAt:Date.now()});
 return <><h3>Maintenance margin</h3><div className="risk-row"><p>Currently {current}% of margin. Raising it liquidates positions sooner. Range 0 to 20.</p>
  <div className="adjust"><label><span className="sr-only">Maintenance margin percent</span><div className="input-wrap"><input type="number" inputMode="decimal" min="0" max="20" step="any" placeholder={String(current)} value={pct} onChange={e=>{setPct(e.target.value);setAskPct(false);}}/><span>%</span></div></label>
  {askPct&&validPct?<><span className="adjust-note" role="status">Set to {n}%? Open positions that fall below it will be liquidated on the next check.</span><button className="primary" disabled={busy} onClick={async()=>{await post("/api/admin",{type:"maintenance",percent:n,...meta()});setPct("");setAskPct(false);}}>Confirm</button><button disabled={busy} onClick={()=>setAskPct(false)}>Cancel</button></>:<button disabled={busy||!validPct} onClick={()=>setAskPct(true)}>Save</button>}</div></div>
  <h3>Open positions</h3>{positions.length?positions.map(x=><PositionRow key={x.id} x={x} busy={busy} post={post} meta={meta}/>):<p className="empty">No open positions.</p>}</>;
}
function PositionRow({x,busy,post,meta}:{x:AdminPos;busy:boolean;post:(path:string,body:object)=>Promise<void>;meta:()=>object}){
 const [price,setPrice]=useState(""),[ask,setAsk]=useState(false);
 const v=Number(price),valid=price.trim()!==""&&Number.isFinite(v)&&v>0;
 return <div className="guest guest-admin"><div><strong>{x.name}</strong><span>{x.symbol} {x.side} {x.leverage}x · entry {usd(x.entry)}</span><span>Liquidation {usd(x.liquidation)}</span></div>
  <div className="adjust"><label><span className="sr-only">New liquidation price in dollars for {x.name} {x.symbol}</span><div className="input-wrap"><span>$</span><input type="number" inputMode="decimal" min="0" step="any" placeholder="New price" value={price} onChange={e=>{setPrice(e.target.value);setAsk(false);}}/></div></label>
  {ask&&valid?<><span className="adjust-note" role="status">Move liquidation to {usd(v*1e6)}? If the market is already past it, the position closes immediately.</span><button className="primary" disabled={busy} onClick={async()=>{await post("/api/admin",{type:"liquidation",publicId:x.publicId,positionId:x.id,price:v,...meta()});setPrice("");setAsk(false);}}>Confirm</button><button disabled={busy} onClick={()=>setAsk(false)}>Cancel</button></>:<button disabled={busy||!valid} onClick={()=>setAsk(true)}>Set liquidation</button>}</div></div>;
}

function LimitsControls({room,busy,post}:{room:PublicRoom;busy:boolean;post:(path:string,body:object)=>Promise<void>}){
 const [trade,setTrade]=useState(""),[lev,setLev]=useState(""),[ask,setAsk]=useState(false);
 const t=trade.trim()===""?room.limits.maxTrade:Number(trade),l=lev.trim()===""?room.limits.maxLeverage:Number(lev);
 const valid=(trade.trim()!==""||lev.trim()!=="")&&Number.isFinite(t)&&t>=1&&t<=1000000&&Number.isInteger(l)&&l>=1&&l<=200;
 return <><h3>Trading limits</h3><div className="risk-row"><p>Max per trade {money(room.limits.maxTrade*100)}. Max leverage {room.limits.maxLeverage}x. The trade cap applies to spot orders, perp margin and perp notional.</p>
  <div className="adjust"><label><span className="sr-only">Max trade in dollars</span><div className="input-wrap"><span>$</span><input type="number" min="1" max="1000000" step="1" placeholder={String(room.limits.maxTrade)} value={trade} onChange={e=>{setTrade(e.target.value);setAsk(false);}}/></div></label><label><span className="sr-only">Max leverage</span><div className="input-wrap"><input type="number" min="1" max="200" step="1" placeholder={String(room.limits.maxLeverage)} value={lev} onChange={e=>{setLev(e.target.value);setAsk(false);}}/><span>x</span></div></label>
  {ask&&valid?<><span className="adjust-note" role="status">Set max trade {money(t*100)} and max leverage {l}x? Existing positions are not closed.</span><button className="primary" disabled={busy} onClick={async()=>{await post("/api/admin",{type:"limits",maxTrade:t,maxLeverage:l,requestId:crypto.randomUUID(),requestAt:Date.now()});setTrade("");setLev("");setAsk(false);}}>Confirm</button><button disabled={busy} onClick={()=>setAsk(false)}>Cancel</button></>:<button disabled={busy||!valid} onClick={()=>setAsk(true)}>Save limits</button>}</div></div></>;
}
function Game(){
 const [room,setRoom]=useState<PublicRoom|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[raise,setRaise]=useState("10"),[buyIn,setBuyIn]=useState("200"),[tab,setTab]=useState<"table"|"standings"|"access"|"markets"|"roulette"|"blackjack">("table"),[clock,setClock]=useState(Date.now());
 const busyRef=useRef(false);
 const load=useCallback(async(signal?:AbortSignal)=>{
  const response=await fetch("/api/room",{cache:"no-store",signal});const data=await response.json();if(!response.ok)throw new Error(data.error);setRoom(data);
 },[]);
 useEffect(()=>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  async function refresh(){try{if(!document.hidden&&!busyRef.current)await load(controller.signal);}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Connection lost.");}finally{if(!controller.signal.aborted)timer=setTimeout(refresh,2000);}}
  refresh();return()=>{controller.abort();clearTimeout(timer);};
 },[load]);

 const {getToken}=useAuth();
 const tokenRef=useRef(getToken);tokenRef.current=getToken;
 useEffect(()=>{
  let closed=false;let socket:import("socket.io-client").Socket|undefined;
  import("socket.io-client").then(({io})=>{
   if(closed)return;
   socket=io({path:"/socket.io",transports:["websocket","polling"],auth:(cb)=>{tokenRef.current().then(token=>cb({token}),()=>cb({}));}});
   const refresh=()=>{if(!busyRef.current)load().catch(()=>{});};
   socket.on("room:update",refresh);socket.on("connect",refresh);
  }).catch(()=>{});
  return()=>{closed=true;socket?.disconnect();};
 },[load]);
 useEffect(()=>{const t=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(t);},[]);
 useEffect(()=>{if(room?.legal)setRaise(String(room.legal.minTo/100));},[room?.handNumber,room?.street,room?.legal?.minTo]);
 async function post(path:string,body:object){
  if(busyRef.current)return;busyRef.current=true;setBusy(true);setError("");
  try{const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,requestAt:Date.now()})});const data=await response.json();if(!response.ok)throw new Error(data.error);setRoom(data);}
  catch(e){setError(e instanceof Error?e.message:"Could not complete action.");try{await load();}catch{}}
  finally{busyRef.current=false;setBusy(false);}
 }
 function action(input:Action){if(room)post("/api/action",{...input,requestId:crypto.randomUUID(),handNumber:room.handNumber,turnDeadline:room.deadline});}
 if(!room)return <main className="waiting"><p className="eyebrow">WELCOME TO THE ROOM</p><h1>Shuffling things up.</h1><p role="status">{error||"Connecting to your table…"}</p></main>;
 const me=room.me;const mySeat=room.seats[me.seat];
 const tabList=["table","blackjack","roulette","markets","standings",...(me.admin?["access"]:[])] as const;
 function tabKeys(e:React.KeyboardEvent){const i=tabList.indexOf(tab as never);const j=e.key==="ArrowRight"?(i+1)%tabList.length:e.key==="ArrowLeft"?(i-1+tabList.length)%tabList.length:e.key==="Home"?0:e.key==="End"?tabList.length-1:-1;if(j<0)return;e.preventDefault();setTab(tabList[j] as typeof tab);document.getElementById("tab-"+tabList[j])?.focus();}const choices=room.legal;
 const offset=room.serverNow-Date.now(),remaining=room.deadline?Math.max(0,Math.ceil((room.deadline-clock-offset)/1000)):0;
 return <main className="game-main"><section className="game-top"><div><h1>{me.approved?"Good to see you, "+me.name+".":"You’re on the guest list."}</h1><p>{me.approved?"No-limit hold’em · Six seats · $1 / $2 / $5":"Your account is ready. Lucas just needs to approve your seat."}</p></div><div className="wallet"><span>Wallet</span><strong>{money(me.wallet)}</strong><small>+ {money(mySeat?.stack||0)} at the table</small></div></section>
 {!me.approved?<div className="approval-note"><span>◷</span><div><h2>A quick nod from the host.</h2><p>Your $1,000 in play money is ready. This page will open automatically once Lucas approves you.</p></div></div>:null}
 <div className="tabs" role="tablist" aria-label="Room views" onKeyDown={tabKeys}>{tabList.map(t=><button key={t} id={"tab-"+t} role="tab" aria-selected={tab===t} aria-controls="panel" tabIndex={tab===t?0:-1} onClick={()=>setTab(t as typeof tab)}>{t==="table"?"Table":t==="standings"?"Standings":t==="markets"?"Markets":t==="roulette"?"Roulette":t==="blackjack"?"Blackjack":"Guest list"}{t==="access"&&room.pending.length?<span className="count">{room.pending.length}</span>:null}</button>)}<span className="connection"><span className="status-dot"/> LIVE ROOM</span></div>
 {error?<div className="error" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError("")}>×</button></div>:null}
 <div role="tabpanel" id="panel" aria-labelledby={"tab-"+tab}>
 {tab==="table"?<div className="table-layout"><section className="table-section" aria-label="Poker table"><div className="table-caption"><span>TABLE 01</span><span>{room.street==="waiting"?"WAITING FOR FRIENDS":room.street.toUpperCase()+" · HAND #"+room.handNumber}</span></div><div className="felt-wrapper"><div className="felt"><div className="felt-mark">ssg200x</div><div className="board"><div className="pot"><small>IN THE MIDDLE</small><strong>{money(room.pot)}</strong></div><div className="community">{Array.from({length:5},(_,i)=>room.board[i]?<Card key={i} value={room.board[i]}/>:<span key={i} className="card placeholder" aria-label="Undealt community card"/>)}</div><p className="table-message">{room.street==="waiting"?"Two friends make a game.":room.street==="showdown"?"A new hand starts shortly.":room.turn!==null?(room.seats[room.turn]?.name||"Player")+" to act · "+remaining+"s":""}</p></div></div>{room.seats.map((seat,i)=><div key={i} className={"seat seat-"+i+(room.turn===i?" acting":"")+(seat?.isYou?" you":"")+(seat?.folded&&seat.inHand?" folded":"")}>{seat?<><div className="seat-top"><span className="avatar">{seat.name.slice(0,1).toUpperCase()}</span><div><strong>{seat.name}{seat.isYou?" (you)":""}</strong><small>{money(seat.stack)}{seat.sitOut?" · sitting out":""}</small></div>{room.button===i?<span className="dealer" title="Dealer button">D</span>:null}</div><div className="hole">{seat.hole.map((card,j)=><Card key={j} value={card} small/>)}{seat.inHand&&seat.folded?<span>FOLDED</span>:seat.inHand&&seat.stack===0&&room.street!=="showdown"?<span>ALL IN</span>:null}</div>{seat.bet>0?<span className="seat-bet">{money(seat.bet)}</span>:null}{seat.leaveAfter?<small>Leaving after hand</small>:null}</>:<button disabled={!me.approved||me.seat>=0||busy} onClick={()=>action({type:"join",seat:i,buyIn:Math.round(Number(buyIn)*100)})}><span>+</span> Seat {i+1}</button>}</div>)}</div>
 <div className="action-bar">{me.seat<0?<><div><strong>Pull up a chair.</strong><p>$100–$1,000 buy-in. Your chips stay yours.</p></div><label>BUY-IN <div className="input-wrap"><span>$</span><input aria-label="Buy-in dollars" inputMode="decimal" type="number" min="100" max={Math.min(1000,me.wallet/100)} value={buyIn} onChange={e=>setBuyIn(e.target.value)}/></div></label></>:<><div><strong>{choices?"Your move.":mySeat?.sitOut?"Taking a breather.":room.street==="showdown"?"Nice hand.":"You’re at the table."}</strong><p>{mySeat?.leaveAfter?"Your remaining stack returns to your wallet after this hand.":choices?"30 seconds. Trust your read.":"The next action will appear here."}</p></div><div className="action-buttons">{choices?<><button disabled={busy} className="muted-button" onClick={()=>action({type:"fold"})}>Fold</button><button disabled={busy} onClick={()=>action({type:choices.check?"check":"call"})}>{choices.check?"Check":"Call "+money(choices.toCall)}</button>{choices.raiseOpen?<><label className="raise-input"><span className="sr-only">Raise total dollars</span><span>$</span><input type="number" inputMode="decimal" min={Math.min(choices.minTo,choices.maxTo)/100} max={choices.maxTo/100} step=".01" value={raise} onChange={e=>setRaise(e.target.value)}/></label><button className="primary" disabled={busy||!Number.isFinite(Number(raise))} onClick={()=>action({type:"raise",to:Math.round(Number(raise)*100)})}>{room.currentBet===0?"Bet":"Raise to"} {money(Math.round(Number(raise||0)*100))}</button><button disabled={busy} onClick={()=>action({type:"raise",to:choices.maxTo})}>All in</button></>:null}</>:mySeat?.sitOut&&!mySeat?.leaveAfter?<button disabled={busy} className="primary" onClick={()=>action({type:"resume"})}>I’m back</button>:null}<button disabled={busy||mySeat?.leaveAfter} className="leave-button" onClick={()=>action({type:"leave"})}>Leave {mySeat?.inHand&&room.street!=="showdown"?"after hand":"table"}</button></div></>}</div></section><aside className="rail"><div><p className="eyebrow">TABLE TALK</p><h2>Every hand<br/>has a story.</h2></div>{room.payouts.length?<div className="winner-note">{room.payouts.map((p,i)=><p key={i}><strong>{room.seats[p.seat]?.name||"Player"} +{money(p.amount)}</strong><span>{p.description}</span></p>)}</div>:null}<ol className="hand-log" aria-label="Hand history">{room.log.length?room.log.map((entry,i)=><li key={room.log.length+"-"+i}>{entry}</li>):<li>The cards are ready. The friends are on their way.</li>}</ol><details className="rules"><summary>House rules</summary><p>$1 small blind, $2 big blind, $5 live UTG straddle with 3+ players. Heads-up is $1/$2. No rake.</p><p>30-second turns. A timeout checks when free, otherwise folds, then sits you out. Refreshing keeps your seat. Leaving during a hand cashes out afterward.</p><p>Minimum raise is the last full raise. Short all-ins do not immediately reopen betting. Side pots and split pots are automatic.</p></details></aside></div>:tab==="markets"?<Markets room={room} busy={busy} post={post}/>:tab==="roulette"?<Roulette room={room} busy={busy} post={post}/>:tab==="blackjack"?<Blackjack room={room} busy={busy} post={post}/>:tab==="standings"?<section className="standings"><p className="eyebrow">BRAGGING RIGHTS</p><h2>Who’s up?</h2><p>Cash, poker chips, spot holdings, and perpetual equity at the latest available prices.</p><table><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Total chips</th><th scope="col">Since joining</th></tr></thead><tbody>{room.leaderboard.map((m,i)=><tr key={m.publicId}><td>{String(i+1).padStart(2,"0")}</td><th scope="row">{m.name}{m.publicId===me.publicId?" (you)":""}</th><td>{money(m.netWorth)}</td><td className={m.pnl>=0?"positive":"negative"}>{signed(m.pnl)}</td></tr>)}</tbody></table></section>:<section className="access"><p className="eyebrow">HOST’S DESK</p><h2>Make room for friends.</h2><p>Everyone signs in with Google. Only you can open their seat.</p><HistoryProgress/><LimitsControls room={room} busy={busy} post={post}/><h3>Waiting for approval</h3>{room.adminUsers.filter(u=>!u.approved).length?room.adminUsers.filter(u=>!u.approved).map(u=><Guest key={u.publicId} m={u} u={u} pending busy={busy} post={post}/>):<p className="empty">No one waiting. All caught up.</p>}<h3>Players</h3>{room.adminUsers.filter(u=>u.approved).map(u=><Guest key={u.publicId} m={u} u={u} self={u.publicId===me.publicId} busy={busy} post={post}/>)}<RiskControls room={room as unknown as AdminRoom} busy={busy} post={post}/></section>}
 </div>
 </main>;
}
