"use client";
import {getTabHeaders} from "@/lib/tab-identity";
import DeviceFingerprint from "./device-fingerprint";
const PlayersList=dynamic(()=>import("./players-list"));
import CasinoAmountInput from "./casino-amount-input";
import {casinoInputCents,isWholeCasinoAmount} from "@/lib/casino-amount";
import {useServerClock} from "./use-server-clock";
import {turnCountdown} from "@/lib/turn-timer";
import dynamic from "next/dynamic";
import Link from "next/link";
const Markets=dynamic(()=>import("./finance-client").then(m=>m.Markets));
const Blackjack=dynamic(()=>import("./blackjack-client"));
const Roulette=dynamic(()=>import("./roulette-client"));
import {SignInButton,UserButton,useUser} from "@clerk/nextjs";
import LiveProvider,{useLive,useLiveEvent,ConnectionBadge} from "./live-provider";
import MaintenanceGate from "./maintenance-gate";
import ChatDock from "./chat-dock";
import {useState,useEffect,useRef} from "react";
import {usePathname,useRouter} from "next/navigation";
import {mergeRoom,mergeMarket,settledNotices,type MarketSnapshot} from "@/lib/room-sync";
import type {PublicRoom} from "@/lib/public";
import type {Action} from "@/lib/types";
const money=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:n%100===0?0:2}).format(n/100);
const signed=(n:number)=>(n>=0?"+":"−")+money(Math.abs(n));
const suits:Record<string,string>={s:"♠",h:"♥",c:"♣",d:"♦"};
function Card({value,small=false}:{value:string;small?:boolean}){
 const back=value==="?";const red=!back&&["h","d"].includes(value.slice(-1));
 return <span aria-label={back?"Hidden card":value} className={"card"+(back?" back":"")+(red?" red":"")+(small?" small":"")}>{back?<span>♠</span>:<><b>{value[0]==="T"?"10":value[0]}</b><i>{suits[value.slice(-1)]}</i></>}</span>;
}
export const routes=[{href:"/poker",label:"Poker",tab:"table"},{href:"/blackjack",label:"Blackjack",tab:"blackjack"},{href:"/roulette",label:"Roulette",tab:"roulette"},{href:"/markets",label:"Markets",tab:"markets"},{href:"/wallet",label:"Wallet",tab:"wallet"},{href:"/leaderboard",label:"Leaderboard",tab:"standings"},{href:"/players",label:"Players",tab:"access",admin:true}] as const;
export default function RoomClient({configured,children}:{configured:boolean;children?:React.ReactNode}){
 const path=usePathname();
 return configured?<Authenticated>{children}</Authenticated>:<Shell>{isPublicPage(path)?children:<Landing setup/>}</Shell>;
}
function isPublicPage(path:string|null){return path==="/leaderboard"||path==="/privacy"||path==="/terms";}
function Authenticated({children}:{children?:React.ReactNode}){
 const {isLoaded,isSignedIn,user}=useUser(),router=useRouter(),path=usePathname();
 const signedOut=isLoaded&&!isSignedIn;
 useEffect(()=>{if(isLoaded&&isSignedIn&&path==="/")router.replace("/poker");},[isLoaded,isSignedIn,path,router]);
 useEffect(()=>{if(signedOut&&path!=="/"&&!isPublicPage(path))router.replace("/");},[signedOut,path,router]);
 const opening=!isLoaded||(isSignedIn&&path==="/");
 return isSignedIn?<LiveProvider key={user.id}><SignedInShell>{opening?<p className="loading" role="status">Opening the room…</p>:isPublicPage(path)?children:<MaintenanceGate>{children}</MaintenanceGate>}</SignedInShell></LiveProvider>:<Shell>{opening?<p className="loading" role="status">Opening the room…</p>:isPublicPage(path)?children:<Landing/>}</Shell>;
}
function SignedInShell({children}:{children:React.ReactNode}){
 const {maintenance}=useLive();
 const {user}=useUser();
 // Only the server-derived boolean is sent to the browser, never Clerk private metadata.
 return <Shell signedIn admin={maintenance?.admin===true} account={<UserButton/>}>{user?<DeviceFingerprint userId={user.id}/>:null}{children}<ChatDock/></Shell>;
}
export function Shell({children,account,signedIn=false,admin=false}:{children:React.ReactNode;account?:React.ReactNode;signedIn?:boolean;admin?:boolean}){
 const path=usePathname()||"";
 return <><header className="mast"><Link className="wordmark" href={signedIn?"/poker":"/"} aria-label="ssg200x home">ssg200x</Link>{signedIn?<nav className="nav-links" aria-label="Sections">{routes.filter(r=>!("admin" in r&&r.admin)||admin).map(r=>{const on=path===r.href||path.startsWith(r.href+"/");return <Link key={r.href} href={r.href} aria-current={on?"page":undefined}>{r.label}</Link>;})}</nav>:<nav className="nav-links" aria-label="Sections"><Link href="/leaderboard">Leaderboard</Link></nav>}<div className="header-right">{signedIn?<Link className="gear" href="/settings" aria-label="Settings" aria-current={path==="/settings"?"page":undefined}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg></Link>:<span className="private-label">Private table</span>}{account}</div></header>{children}<footer><span>ssg200x</span><span><Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link></span></footer></>;
}
function Landing({setup=false}:{setup?:boolean}){
 return <main className="landing"><section><h1>Poker with friends.</h1><p className="intro">No-limit hold’em with play money. Everyone starts with $1,000 and a seat at the table.</p>{setup?<p className="setup" role="status">The table is being set. Clerk keys are needed before sign-in opens.</p>:<SignInButton mode="modal"><button className="primary google"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.8 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.5a4.7 4.7 0 0 1-2 3.1v2.6h3.3c1.9-1.8 3-4.4 3-7.6ZM12 22c2.7 0 5-.9 6.7-2.5l-3.3-2.6c-.9.6-2.1.9-3.4.9-2.6 0-4.8-1.8-5.6-4.1H3v2.7A10 10 0 0 0 12 22ZM6.4 13.7a6 6 0 0 1 0-3.4V7.6H3a10 10 0 0 0 0 8.8l3.4-2.7ZM12 6.2c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.7 9.7 0 0 0 12 2a10 10 0 0 0-9 5.6l3.4 2.7A6 6 0 0 1 12 6.2Z"/></svg>Continue with Google</button></SignInButton>}<p className="fine"><Link href="/leaderboard">View the public leaderboard</Link></p></section></main>;
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
export type RoomTab="table"|"standings"|"access"|"markets"|"roulette"|"blackjack";
export function RoomView({tab}:{tab:RoomTab}){
 return <Game tab={tab}/>;
}
function Game({tab}:{tab:RoomTab}){
 const router=useRouter();
 const [room,setRoom]=useState<PublicRoom|null>(null),[error,setError]=useState(""),[busyState,setBusy]=useState(false),[raise,setRaise]=useState("10"),[buyIn,setBuyIn]=useState("200");
 const [marketNotice,setMarketNotice]=useState("");
 const seenActivity=useRef<Set<string>|null>(null);
 useEffect(()=>{if(room&&tab==="access"&&!room.me.admin)router.replace("/poker");},[room,tab,router]);
 useEffect(()=>{if(!room)return;const settled=settledNotices(room.activity||[]);if(!seenActivity.current){seenActivity.current=new Set(settled.map(s=>s.id));return;}const fresh=settled.filter(s=>!seenActivity.current!.has(s.id));for(const s of settled)seenActivity.current.add(s.id);if(fresh.length)setMarketNotice(fresh.reverse().map(s=>s.text.replace(/ · position \S+/g,"").replace(/(\d+\.\d{2}) returned/g,(_,n)=>"$"+Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})+" returned")).join(". "));},[room?.activity]);
 const {connection}=useLive();
 const busyRef=useRef(false),busy=busyState||connection!=="connected";
 useEffect(()=>{
  const controller=new AbortController();
  fetch("/api/room",{cache:"no-store",signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error);setRoom(current=>mergeRoom(current,data as PublicRoom));}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Connection lost.");});
  return()=>controller.abort();
 },[]);
 useLiveEvent("room:state",(payload:PublicRoom)=>{if(payload&&typeof payload.version==="number"){setRoom(current=>mergeRoom(current,payload));setError("");}});
 useLiveEvent("market:update",(payload:MarketSnapshot)=>{setRoom(current=>mergeMarket(current,payload));});
 const clock=useServerClock(room?.serverNow??0);
 useEffect(()=>{if(room?.legal)setRaise(String(Math.ceil(room.legal.minTo/100)));},[room?.handNumber,room?.street,room?.legal?.minTo]);
 async function post(path:string,body:object){
  if(busyRef.current)return;if(connection!=="connected"){setError("Disconnected. Wait for the connection to return.");return;}busyRef.current=true;setBusy(true);setError("");
  try{const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json",...getTabHeaders()},body:JSON.stringify({...body,requestAt:Date.now()})});const data=await response.json();if(!response.ok)throw new Error(data.error);setRoom(current=>mergeRoom(current,data));}
  catch(e){setError(e instanceof Error?e.message:"Could not complete action.");}
  finally{busyRef.current=false;setBusy(false);}
 }
 function action(input:Action){if(room)post("/api/action",{...input,requestId:crypto.randomUUID(),handNumber:room.handNumber,turnDeadline:room.deadline});}
 if(!room)return <main className="waiting"><p className="eyebrow">WELCOME TO THE ROOM</p><h1>Shuffling things up.</h1><p role="status">{error||"Connecting to your table…"}</p></main>;
 const me=room.me;const mySeat=room.seats[me.seat];
 const choices=room.legal;
 const buyInCents=casinoInputCents(buyIn),raiseCents=casinoInputCents(raise);
 const buyInOk=buyInCents!==null&&buyInCents>=10000&&buyInCents<=100000&&buyInCents<=me.wallet;
 const raiseOk=raiseCents!==null&&choices!==null&&raiseCents>=Math.min(choices.minTo,choices.maxTo)&&raiseCents<=choices.maxTo;
 const remaining=turnCountdown(room.deadline,clock);
 const readySeconds=room.readyDeadline?Math.max(0,Math.ceil((room.readyDeadline-clock)/1000)):0;
 const readyClock=Math.floor(readySeconds/60)+":"+String(readySeconds%60).padStart(2,"0");
 const canReady=room.street==="waiting"&&mySeat&&!mySeat.ready;
 const canCashOut=mySeat&&!(mySeat.inHand&&room.street!=="waiting"&&room.street!=="showdown");
 return <main className="game-main"><section className="game-top"><div><h1>{"Good to see you, "+me.name+"."}</h1><p>No-limit hold’em · Six seats · $1 / $2 / $5</p></div><div className="wallet"><span>Wallet</span><strong>{money(me.wallet)}</strong><small>+ {money(mySeat?.stack||0)} at the table</small></div></section>
 <div className="room-status"><span className="connection"><span className="status-dot"/> {connection==="connected"?"LIVE ROOM":connection==="connecting"?"CONNECTING":"OFFLINE"}</span></div>
 <ConnectionBadge/>
 {marketNotice?<div className="winner-note" role="status" aria-live="polite">{marketNotice}<button aria-label="Dismiss market notice" onClick={()=>setMarketNotice("")}>×</button></div>:null}
 {error?<div className="error" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError("")}>×</button></div>:null}
 <div id="panel">
 {tab==="table"?<div className="table-layout"><section className="table-section" aria-label="Poker table"><div className="table-caption"><span>TABLE 01</span><span>{room.street==="waiting"?"WAITING FOR FRIENDS":room.street.toUpperCase()+" · HAND #"+room.handNumber}</span></div><div className="felt-wrapper"><div className="felt"><div className="felt-mark">ssg200x</div><div className="board"><div className="pot"><small>IN THE MIDDLE</small><strong>{money(room.pot)}</strong></div><div className="community">{Array.from({length:5},(_,i)=>room.board[i]?<Card key={i} value={room.board[i]}/>:<span key={i} className="card placeholder" aria-label="Undealt community card"/>)}</div><p className="table-message">{room.street==="waiting"?room.readyDeadline?"Waiting for everyone to be ready · "+readyClock:"Everyone seated must be ready. At least two players.":room.street==="showdown"?"Next hand needs everyone to be ready.":room.turn!==null?(room.seats[room.turn]?.name||"Player")+" to act"+(remaining===null?"":" · "+remaining+"s"):""}</p></div></div>{room.seats.map((seat,i)=><div key={i} className={"seat seat-"+i+(room.turn===i?" acting":"")+(seat?.isYou?" you":"")+(seat?.folded&&seat.inHand?" folded":"")}>{seat?<><div className="seat-top"><span className="avatar">{seat.name.slice(0,1).toUpperCase()}</span><div><strong>{seat.name}{seat.isYou?" (you)":""}</strong><small>{money(seat.stack)}{seat.ready?" · ready":!seat.inHand?" · not ready":seat.sitOut?" · sitting out":""}</small></div>{room.button===i?<span className="dealer" title="Dealer button">D</span>:null}</div><div className="hole">{seat.hole.map((card,j)=><Card key={j} value={card} small/>)}{seat.inHand&&seat.folded?<span>FOLDED</span>:seat.inHand&&seat.stack===0&&room.street!=="showdown"?<span>ALL IN</span>:null}</div>{seat.bet>0?<span className="seat-bet">{money(seat.bet)}</span>:null}{seat.leaveAfter?<small>Leaving after hand</small>:null}</>:<button disabled={me.seat>=0||busy||!buyInOk} onClick={()=>{if(buyInOk&&buyInCents!==null)action({type:"join",seat:i,buyIn:buyInCents});}}><span>+</span> Seat {i+1}</button>}</div>)}</div>
 <div className="action-bar">{me.seat<0?<><div><strong>Pull up a chair.</strong><p>$100–$1,000 buy-in. Timeouts and five inactive hands forfeit your table chips.</p></div><label>BUY-IN <div className="input-wrap"><span>$</span><CasinoAmountInput aria-label="Buy-in dollars" min="100" max={Math.min(1000,Math.floor(me.wallet/100))} value={buyIn} onChange={setBuyIn}/></div></label></>:<><div><strong>{choices?"Your move.":mySeat?.inHand&&room.street!=="showdown"?"Hand in progress.":mySeat?.ready?"You’re ready.":room.street==="showdown"?"Nice hand.":"You’re at the table."}</strong><p>{choices?"100 seconds per turn. Timeout forfeits your entire table stack.":mySeat?.inHand&&room.street!=="showdown"?"Cash out is unavailable until this hand finishes.":mySeat?.ready?"You can unready or cash out before the hand starts. After five minutes, unready players cash out. Two or more ready players start; a lone ready player becomes unready and keeps their seat and chips.":canReady?"Ready up to play, or cash out your stack to your wallet.":canCashOut?"Cash out now, or ready up once the next hand opens.":"Wait for this hand to finish before readying or cashing out."}</p></div><div className="action-buttons">{choices?<><button disabled={busy} className="muted-button" onClick={()=>action({type:"fold"})}>Fold</button><button disabled={busy} onClick={()=>action({type:choices.check?"check":"call"})}>{choices.check?"Check":"Call "+money(choices.toCall)}</button>{choices.raiseOpen?<><label className="raise-input"><span className="sr-only">Raise total dollars</span><span>$</span><CasinoAmountInput min={Math.ceil(Math.min(choices.minTo,choices.maxTo)/100)} max={Math.floor(choices.maxTo/100)} value={raise} onChange={setRaise}/></label><button className="primary" disabled={busy||!raiseOk} onClick={()=>{if(raiseOk&&raiseCents!==null)action({type:"raise",to:raiseCents});}}>{room.currentBet===0?"Bet":"Raise to"} {money(raiseCents??0)}</button><button disabled={busy||!isWholeCasinoAmount(choices.maxTo)} title={isWholeCasinoAmount(choices.maxTo)?undefined:"Raise totals must be whole dollars."} onClick={()=>{if(isWholeCasinoAmount(choices.maxTo))action({type:"raise",to:choices.maxTo});}}>All in</button></>:null}</>:canReady?<button disabled={busy} className="primary" onClick={()=>action({type:"ready"})}>Ready</button>:mySeat?.ready&&canCashOut?<button disabled={busy} onClick={()=>action({type:"unready"})}>Unready</button>:null}<button disabled={busy||!canCashOut} className="leave-button" onClick={()=>action({type:"leave"})}>Cash out {money(mySeat?.stack||0)}</button></div></>}</div></section><aside className="rail"><div><p className="eyebrow">TABLE TALK</p><h2>Every hand<br/>has a story.</h2></div>{room.payouts.length?<div className="winner-note">{room.payouts.map((p,i)=><p key={i}><strong>{room.seats[p.seat]?.name||"Player"} +{money(p.amount)}</strong><span>{p.description}</span></p>)}</div>:null}<ol className="hand-log" aria-label="Hand history">{room.log.length?room.log.map((entry,i)=><li key={room.log.length+"-"+i}>{entry}</li>):<li>The cards are ready. The friends are on their way.</li>}</ol><details className="rules"><summary>House rules</summary><p>$1 small blind, $2 big blind, $5 live UTG straddle with 3+ players. Heads-up is $1/$2. No rake.</p><p>100-second turns. Timeout removes your seat and adds your entire table stack to the hand’s pot. Five consecutive completed hands without playing also removes your seat and forfeits its chips. Refreshing does not reset the timer. Cash out whenever you are not in an active hand, even if ready.</p><p>All seated players not sitting out must press Ready, with at least two players. You can unready before a hand starts. Five minutes after the first Ready, unready players are unseated and all their chips return to their wallets. The hand starts with two or more ready players. A lone ready player stays seated with their chips and becomes unready. Ready again after each hand.</p><p>Black 78: a black 7 and a black 8 as your two hole cards beat every other hand at showdown, even a royal flush. Two Black 78 hands split eligible pots. Folding still forfeits the hand.</p><p>Minimum raise is the last full raise. Short all-ins do not immediately reopen betting. Side pots and split pots are automatic.</p></details></aside></div>:tab==="markets"?<Markets room={room} busy={busy} post={post}/>:tab==="roulette"?<Roulette room={room} busy={busy} post={post}/>:tab==="blackjack"?<Blackjack room={room} busy={busy} post={post}/>:tab==="standings"?<section className="standings"><p className="eyebrow">BRAGGING RIGHTS</p><h2>Who’s up?</h2><p>Cash, poker chips, spot holdings, and perpetual equity at the latest available prices.</p><table><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Total chips</th><th scope="col">Since joining</th></tr></thead><tbody>{room.leaderboard.map((m,i)=><tr key={m.publicId}><td>{String(i+1).padStart(2,"0")}</td><th scope="row">{m.name}{m.publicId===me.publicId?" (you)":""}</th><td>{money(m.netWorth)}</td><td className={m.pnl>=0?"positive":"negative"}>{signed(m.pnl)}</td></tr>)}</tbody></table></section>:<section className="access"><LimitsControls room={room} busy={busy} post={post}/><PlayersList users={room.adminUsers} busy={busy} post={post} onRefresh={async signal=>{const response=await fetch("/api/room",{cache:"no-store",signal});const data=await response.json();if(!response.ok)throw new Error(data.error||"Players unavailable.");setRoom(current=>mergeRoom(current,data as PublicRoom));}}/><RiskControls room={room as unknown as AdminRoom} busy={busy} post={post}/></section>}
 </div>
 </main>;
}
