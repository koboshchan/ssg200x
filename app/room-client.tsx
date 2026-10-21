"use client";
import {usePokerModeration} from "./use-poker-moderation";
import {PokerPlayerMenu} from "./poker-player-menu";
import {PokerTauntProvider,PokerTauntControls,PokerTauntEffects} from "./poker-taunts";
import LimitsControls from "./trading-limit-controls";
import {usePendingFinance} from "./use-pending-finance";
import PerpFeeControl from "./perp-fee-control";
import {getTabHeaders} from "@/lib/tab-identity";
import DeviceFingerprint from "./device-fingerprint";
import InPlayNavigation from "./in-play-navigation";
const PlayersList=dynamic(()=>import("./players-list"));
const MarketSymbolSettings=dynamic(()=>import("./market-symbol-settings"));
const DoudizhuRateSettings=dynamic(()=>import("./doudizhu-rate-settings"));
const CasinoLimitSettings=dynamic(()=>import("./casino-limit-settings"));
import CasinoAmountInput from "./casino-amount-input";
import {casinoInputCents,isWholeCasinoAmount} from "@/lib/casino-amount";
import {useServerClock} from "./use-server-clock";
import {turnCountdown,POKER_TURN_MS,POKER_WARNING_MS} from "@/lib/turn-timer";
import dynamic from "next/dynamic";
import Link from "next/link";
const Markets=dynamic(()=>import("./finance-client").then(m=>m.Markets));
const Blackjack=dynamic(()=>import("./blackjack-client"));
const Roulette=dynamic(()=>import("./roulette-client"));
import {SignInButton,UserButton,useUser} from "@clerk/nextjs";
import LiveProvider,{useLive,useLiveEvent,ConnectionBadge} from "./live-provider";
import MaintenanceGate from "./maintenance-gate";
import ChatDock from "./chat-dock";
import {useState,useEffect,useRef,useCallback} from "react";
import {usePathname,useRouter} from "next/navigation";
import {mergeRoom,mergeMarket,settledNotices,type MarketSnapshot} from "@/lib/room-sync";
import SeatAvatar from "./seat-avatar";
import {PokerKickDemoButton} from "./poker-kick-demo-button";
import {KickVotePopup,type KickVote} from "./seat-kick";
import type {PublicRoom} from "@/lib/public";
import {visibleSeatIds,isLegacyLayout,isDenseTable,denseSeatSlots,denseTableHeight,denseMobileLayout,POKER_TABLE_IDS,readPokerTableId,writePokerTableId,type PokerTableId} from "@/lib/poker-table-selection";
import type {Action} from "@/lib/types";
const money=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:n%100===0?0:2}).format(n/100);
const signed=(n:number)=>(n>=0?"+":"−")+money(Math.abs(n));
const suits:Record<string,string>={s:"♠",h:"♥",c:"♣",d:"♦"};
function Card({value,small=false}:{value:string;small?:boolean}){
 const back=value==="?";const red=!back&&["h","d"].includes(value.slice(-1));
 return <span aria-label={back?"Hidden card":value} className={"card"+(back?" back":"")+(red?" red":"")+(small?" small":"")}>{back?<span>♠</span>:<><b>{value[0]==="T"?"10":value[0]}</b><i>{suits[value.slice(-1)]}</i></>}</span>;
}
export const routes=[{href:"/poker",label:"Poker",tab:"table"},{href:"/blackjack",label:"Blackjack",tab:"blackjack"},{href:"/doudizhu",label:"Dou Dizhu",tab:"doudizhu"},{href:"/roulette",label:"Roulette",tab:"roulette"},{href:"/games",label:"Games",tab:"games"},{href:"/markets",label:"Markets",tab:"markets"},{href:"/wallet",label:"Wallet",tab:"wallet"},{href:"/leaderboard",label:"Leaderboard",tab:"standings"},{href:"/advancements",label:"Advancements",tab:"advancements"},{href:"/players",label:"Admin",tab:"access",admin:true}] as const;
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
 return <Shell signedIn admin={maintenance?.admin===true} account={<UserButton/>}><InPlayNavigation/>{user?<DeviceFingerprint userId={user.id}/>:null}{children}<ChatDock/></Shell>;
}
export function Shell({children,account,signedIn=false,admin=false}:{children:React.ReactNode;account?:React.ReactNode;signedIn?:boolean;admin?:boolean}){
 const path=usePathname()||"";
 return <><header className="mast"><Link className="wordmark" href={signedIn?"/poker":"/"} aria-label="ssg200x home">ssg200x</Link>{signedIn?<nav className="nav-links" aria-label="Sections">{routes.filter(r=>!("admin" in r&&r.admin)||admin).map(r=>{const on=path===r.href||path.startsWith(r.href+"/");return <Link key={r.href} href={r.href} aria-current={on?"page":undefined}>{r.label}</Link>;})}</nav>:<nav className="nav-links" aria-label="Sections"><Link href="/leaderboard">Leaderboard</Link></nav>}<div className="header-right">{signedIn?<Link className="gear" href="/settings" aria-label="Settings" aria-current={path==="/settings"?"page":undefined}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M9.5 3h5l.6 3 1.3.8 2.9-.9 2.5 4.2-2.3 2v1.8l2.3 2-2.5 4.2-2.9-.9-1.3.8-.6 3h-5l-.6-3-1.3-.8-2.9.9-2.5-4.2 2.3-2v-1.8l-2.3-2L4.7 5.9l2.9.9L8.9 6l.6-3Z"/></svg></Link>:<span className="private-label">Private table</span>}{account}</div></header>{children}<footer><span>ssg200x</span><span><Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link></span></footer></>;
}
function Landing({setup=false}:{setup?:boolean}){
 return <main className="landing"><section><h1>Poker with friends.</h1><p className="intro">No-limit hold’em with play money. Everyone starts with $1,000 and a seat at the table.</p>{setup?<p className="setup" role="status">The table is being set. Clerk keys are needed before sign-in opens.</p>:<SignInButton mode="modal"><button className="primary google"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.8 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.5a4.7 4.7 0 0 1-2 3.1v2.6h3.3c1.9-1.8 3-4.4 3-7.6ZM12 22c2.7 0 5-.9 6.7-2.5l-3.3-2.6c-.9.6-2.1.9-3.4.9-2.6 0-4.8-1.8-5.6-4.1H3v2.7A10 10 0 0 0 12 22ZM6.4 13.7a6 6 0 0 1 0-3.4V7.6H3a10 10 0 0 0 0 8.8l3.4-2.7ZM12 6.2c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.7 9.7 0 0 0 12 2a10 10 0 0 0-9 5.6l3.4 2.7A6 6 0 0 1 12 6.2Z"/></svg>Continue with Google</button></SignInButton>}<p className="fine"><Link href="/leaderboard">View the public leaderboard</Link></p></section></main>;
}

type AdminPos={publicId:string;name:string;id:string;symbol:string;side:string;leverage:number;entry:number;liquidation:number};
type AdminRoom={perpFeePpm?:number;perpOpeningFeePpm?:number;perpClosingFeePpm?:number;perpClosingFeeMode?:"notional"|"profit";maintenancePercent?:number;adminPositions?:AdminPos[]};
const usd=(micro:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:micro/1e6<1?6:2}).format(micro/1e6);
function RiskControls({room,busy,post}:{room:AdminRoom;busy:boolean;post:(path:string,body:object)=>Promise<void>}){
 const current=room.maintenancePercent??0,positions=room.adminPositions||[];
 const [pct,setPct]=useState(""),[askPct,setAskPct]=useState(false);
 const n=Number(pct),validPct=pct.trim()!==""&&Number.isFinite(n)&&n>=0&&n<=20;
 const meta=()=>({requestId:crypto.randomUUID(),requestAt:Date.now()});
 return <><PerpFeeControl opening={room.perpOpeningFeePpm??room.perpFeePpm??300} closing={room.perpClosingFeePpm??room.perpFeePpm??300} mode={room.perpClosingFeeMode??"notional"} busy={busy} post={post}/><h3>Maintenance margin</h3><div className="risk-row"><p>Currently {current}% of margin. Raising it liquidates positions sooner. Range 0 to 20.</p>
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

export type RoomTab="table"|"standings"|"access"|"markets"|"roulette"|"blackjack";
export function RoomView({tab}:{tab:RoomTab}){
 return <Game tab={tab}/>;
}
function Game({tab}:{tab:RoomTab}){
 const router=useRouter(),pathname=usePathname();

 const feltRef=useRef<HTMLDivElement>(null),[tauntsMuted,setTauntsMuted]=useState(false);
 const pokerHeader=pathname==="/poker"||(pathname==="/"&&tab==="table");
 const [tableId,setTableId]=useState<PokerTableId>("01"),tableRef=useRef<PokerTableId>("01"),[room,setRoomRaw]=useState<PublicRoom|null>(null),[error,setError]=useState(""),[busyState,setBusy]=useState(false),[raise,setRaise]=useState("10"),[buyIn,setBuyIn]=useState("200");
 const [marketNotice,setMarketNotice]=useState("");
 const setRoom=(update:(current:PublicRoom|null)=>PublicRoom|null)=>setRoomRaw(current=>{const next=update(current);return next&&next.pokerTableId&&next.pokerTableId!==tableRef.current?current:next;});
 useEffect(()=>{const saved=readPokerTableId();tableRef.current=saved;setTableId(saved);},[]);
 const {emit}=useLive();
 function chooseTable(id:PokerTableId){if(id===tableRef.current)return;tableRef.current=id;writePokerTableId(id);setTableId(id);setRaise("10");setRoomRaw(null);emit("poker:subscribe",id);}
 const seenActivity=useRef<Set<string>|null>(null);
 useEffect(()=>{if(room&&tab==="access"&&!room.me.admin)router.replace("/poker");},[room,tab,router]);
 useEffect(()=>{if(!room)return;const settled=settledNotices(room.activity||[]);if(!seenActivity.current){seenActivity.current=new Set(settled.map(s=>s.id));return;}const fresh=settled.filter(s=>!seenActivity.current!.has(s.id));for(const s of settled)seenActivity.current.add(s.id);if(fresh.length)setMarketNotice(fresh.reverse().map(s=>s.text.replace(/ · position \S+/g,"").replace(/(\d+\.\d{2}) returned/g,(_,n)=>"$"+Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})+" returned")).join(". "));},[room?.activity]);
 const {connection}=useLive();
 const {user}=useUser();
  const finance=usePendingFinance(user?.id,connection==="connected",data=>{if(data?.pokerTableId&&data.pokerTableId!==tableRef.current){fetch("/api/room?tableId="+tableRef.current,{cache:"no-store"}).then(async r=>{const d=await r.json();if(r.ok)setRoom(c=>mergeRoom(c,d as PublicRoom));}).catch(()=>{});return;}setRoom(current=>mergeRoom(current,data));});
 const busyRef=useRef(false),busy=busyState||connection!=="connected"||!finance?.ready||!!finance?.pending;
 useEffect(()=>{
  const controller=new AbortController();
  fetch("/api/room?tableId="+tableId,{cache:"no-store",signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error);if(controller.signal.aborted||tableRef.current!==tableId)return;setRoom(current=>mergeRoom(current,data as PublicRoom));}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Connection lost.");});
  return()=>controller.abort();
 },[tableId]);
 useLiveEvent("room:state",(payload:PublicRoom)=>{if(payload&&typeof payload.version==="number"&&(!payload.pokerTableId||payload.pokerTableId===tableRef.current)){setRoom(current=>mergeRoom(current,payload));setError("");}});
 useLiveEvent("market:update",(payload:MarketSnapshot)=>{setRoom(current=>mergeMarket(current,payload));});
 const receivedRoomAt=useRef(Date.now());
 useEffect(()=>{receivedRoomAt.current=Date.now();},[room?.serverNow]);
 const clock=useServerClock(room?.serverNow??0);
 const [kickBusy,setKickBusy]=useState(false),[kickError,setKickError]=useState("");
 const currentTableRef=useRef("01");
 currentTableRef.current=room?.pokerTableId||tableId;
 const currentSeatsRef=useRef<(({publicId:string}|null)[])>([]);
 currentSeatsRef.current=room?.seats??[];
 const kickRef=useRef<(body:Record<string,unknown>)=>void>(()=>{});
 const pendingKicks=useRef(new Map<string,Record<string,unknown>>());
 const pokerModeration=usePokerModeration(room,connection==="connected",kickBusy);
 useEffect(()=>{const on=(e:Event)=>{const d=(e as CustomEvent).detail;if(d&&(d.action==="admin-kick"||d.action==="start")&&typeof d.targetPublicId==="string"&&(d.tableId===undefined||d.tableId===currentTableRef.current)&&(d.seat===undefined||currentSeatsRef.current[d.seat]?.publicId===d.targetPublicId))kickRef.current({action:d.action,targetPublicId:d.targetPublicId});};window.addEventListener("poker-kick-request",on);return()=>window.removeEventListener("poker-kick-request",on);},[]);
 async function kickCall(body:Record<string,unknown>){if(!room||kickBusy)return;const table=room.pokerTableId||tableId;const saved=pendingKicks.current.get(table);const same=(a:Record<string,unknown>)=>a.action===body.action&&a.targetPublicId===body.targetPublicId&&a.voteId===body.voteId&&a.yes===body.yes;if(saved&&!same(saved)){setKickError("Retry your previous player action first.");return;}const payload=saved??{...body,tableId:table,requestId:crypto.randomUUID(),requestAt:Date.now()};pendingKicks.current.set(table,payload);setKickBusy(true);setKickError("");try{const response=await fetch("/api/poker-kicks",{method:"POST",headers:{"Content-Type":"application/json",...getTabHeaders()},body:JSON.stringify(payload)});const data=await response.json();if(!response.ok){if(response.status<500)pendingKicks.current.delete(table);throw new Error(data.error);}pendingKicks.current.delete(table);if(table===currentTableRef.current&&(data.pokerTableId??table)===table)setRoom(current=>mergeRoom(current,data));}catch(e){setKickError(e instanceof Error?e.message:"Not confirmed. Click the same action again to retry safely.");}finally{setKickBusy(false);}}
 kickRef.current=kickCall;
 useEffect(()=>{if(room?.legal)setRaise(String(Math.ceil(room.legal.minTo/100)));},[room?.handNumber,room?.street,room?.legal?.minTo]);
 async function post(path:string,body:object){
  if(path==="/api/finance"){if(!busyRef.current&&room&&finance)await finance.submit(body,room.serverNow+Math.max(0,Date.now()-receivedRoomAt.current));return;}
  if(busyRef.current||!finance?.ready)return;if(connection!=="connected"){setError("Disconnected. Wait for the connection to return.");return;}busyRef.current=true;setBusy(true);setError("");
  try{const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json",...getTabHeaders()},body:JSON.stringify(path==="/api/blackjack"?{...body,requestAt:Date.now()}:{...body,tableId:tableRef.current,requestAt:Date.now()})});const data=await response.json();if(!response.ok)throw new Error(data.error);setRoom(current=>mergeRoom(current,data));}
  catch(e){setError(e instanceof Error?e.message:"Could not complete action.");}
  finally{busyRef.current=false;setBusy(false);}
 }
 function action(input:Action){if(room)post("/api/action",{...input,requestId:crypto.randomUUID(),handNumber:room.handNumber,turnDeadline:room.deadline});}
 if(!room)return <main className="waiting"><p className="eyebrow">WELCOME TO THE ROOM</p><h1>Shuffling things up.</h1><p role="status">{error||"Connecting to your table…"}</p></main>;
 const me=room.me;const mySeat=room.seats[me.seat];
 const viewId=room.pokerTableId||tableId,seatedId=room.me.pokerTableId??null,elsewhere=seatedId&&seatedId!==viewId?seatedId:null;
 const tableLabel="Table "+viewId;
 const seatIds=visibleSeatIds(room.seats),seatCount=seatIds.length,legacy=isLegacyLayout(seatIds),denseSlots=denseSeatSlots(seatCount);const mobileDense=denseMobileLayout(seatCount);
 const choices=room.legal;
 const buyInCents=casinoInputCents(buyIn),raiseCents=casinoInputCents(raise);
 const buyInOk=buyInCents!==null&&buyInCents>=10000&&buyInCents<=room.casinoLimits.pokerMaxBuyIn&&buyInCents<=me.wallet;
 const raiseOk=raiseCents!==null&&choices!==null&&raiseCents>=Math.min(choices.minTo,choices.maxTo)&&raiseCents<=choices.maxTo;
 const remaining=turnCountdown(room.deadline,clock,POKER_TURN_MS,POKER_WARNING_MS);
 const readySeconds=room.readyDeadline?Math.max(0,Math.ceil((room.readyDeadline-clock)/1000)):0;
 const readyClock=Math.floor(readySeconds/60)+":"+String(readySeconds%60).padStart(2,"0");
 const canReady=room.street==="waiting"&&mySeat&&!mySeat.ready;
 const canCashOut=mySeat&&!(mySeat.inHand&&room.street!=="waiting"&&room.street!=="showdown");
 return <main className="game-main"><section className="game-top"><div><h1>{"Good to see you, "+me.name+"."}</h1>{pokerHeader?<p>No-limit hold’em · Up to 12 seats · $1 / $2 / $5</p>:null}</div><div className="wallet"><span>Wallet</span><strong>{money(me.wallet)}</strong>{pokerHeader?<small>+ {money(mySeat?.stack||0)} at the table</small>:null}</div></section>
 <div className="room-status"><span className="connection"><span className="status-dot"/> {connection==="connected"?"LIVE ROOM":connection==="connecting"?"CONNECTING":"OFFLINE"}</span></div>
 <ConnectionBadge/>
 {finance&&!finance.ready?<p role="status">{finance.pending?"Checking your previous order. New orders are paused.":"Refreshing the room before trading."}{finance.error?" "+finance.error:""} <button disabled={connection!=="connected"||finance.working} onClick={()=>void finance.sync()}>Check again</button></p>:null}
 {finance?.ready&&finance.error?<p role="alert">{finance.error}</p>:null}
 {finance?.message?<p role="status">{finance.message}</p>:null}
 {marketNotice?<div className="winner-note" role="status" aria-live="polite">{marketNotice}<button aria-label="Dismiss market notice" onClick={()=>setMarketNotice("")}>×</button></div>:null}
 {error?<div className="error" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError("")}>×</button></div>:null}
 <div id="panel">
 {tab==="table"?<div className="table-layout"><PokerTauntProvider room={room} muted={tauntsMuted}><section className="table-section" aria-label="Poker table"><nav className="table-picker" aria-label="Poker tables">{POKER_TABLE_IDS.map(id=>{const t=room.pokerTables?.find(x=>x.id===id);return <button key={id} type="button" className={"table-pick"+(id===viewId?" active":"")} aria-pressed={id===viewId} onClick={()=>chooseTable(id)}><strong>Table {id}</strong><small>{t?t.seatsFilled+"/"+t.seatCount+" seated":"…"}{seatedId===id?" · you":""}</small></button>;})}</nav>{elsewhere?<p className="table-elsewhere" role="status">You’re seated at <button type="button" className="link-button" onClick={()=>chooseTable(elsewhere)}>Table {elsewhere}</button>. Cash out there before joining another table.</p>:null}<div className="table-caption"><span>{tableLabel.toUpperCase()}</span><span>{room.street==="waiting"?"WAITING FOR FRIENDS":room.street.toUpperCase()+" · HAND #"+room.handNumber}</span><PokerTauntControls muted={tauntsMuted} setMuted={setTauntsMuted}/><PokerKickDemoButton tableId={room.pokerTableId||tableId} onRoom={d=>setRoom(current=>mergeRoom(current,d as never))}/></div><PokerPlayerMenu room={room} moderation={pokerModeration}><div ref={feltRef} className={"felt-wrapper"+(legacy?"":" dense")} data-seat-count={seatCount} style={legacy?undefined:({"--dense-h":denseTableHeight(seatCount)+"px","--mh":mobileDense.height+"px","--mb":mobileDense.boardY+"px"} as React.CSSProperties)}><PokerTauntEffects room={room} wrapper={feltRef} muted={tauntsMuted}/><div className="felt"><div className="felt-mark">ssg200x</div><div className="board"><div className="pot"><small>IN THE MIDDLE</small><strong>{money(room.pot)}</strong></div><div className="community">{Array.from({length:5},(_,i)=>room.board[i]?<Card key={i} value={room.board[i]}/>:<span key={i} className="card placeholder" aria-label="Undealt community card"/>)}</div><p className="table-message">{room.street==="waiting"?room.readyDeadline?"Waiting for everyone to be ready · "+readyClock:"Everyone seated must be ready. At least two players.":room.street==="showdown"?"Next hand needs everyone to be ready.":room.turn!==null?(room.seats[room.turn]?.name||"Player")+" to act"+(remaining===null?"":" · "+remaining+"s"):""}</p></div></div>{seatIds.map((i,pos)=>{const seat=room.seats[i];return <div key={i} data-seat-index={i} data-poker-seat={i} tabIndex={seat?0:undefined} aria-haspopup={seat?"menu":undefined} data-seat-pos={pos} style={legacy?undefined:({"--x":denseSlots[pos].x+"%","--y":denseSlots[pos].y+"%","--mx":mobileDense.slots[pos].x+"%","--my":mobileDense.slots[pos].y+"px"} as React.CSSProperties)} className={"seat seat-"+i+(room.turn===i?" acting":"")+(seat?.isYou?" you":"")+(seat?.folded&&seat.inHand?" folded":"")}>{seat?<><div className="seat-top"><SeatAvatar name={seat.name} imageUrl={(seat as {avatar?:string|null}).avatar}/><div><strong>{seat.name}{seat.isYou?" (you)":""}</strong><small>{money(seat.stack)}{seat.ready?" · ready":!seat.inHand?" · not ready":seat.sitOut?" · sitting out":""}</small></div>{room.button===i?<span className="dealer" title="Dealer button">D</span>:null}</div><div className={"hole"+(room.street==="showdown"?" hand-reveal":"")}>{seat.hole.map((card,j)=><Card key={j} value={card} small/>)}{seat.inHand&&seat.folded?<span>FOLDED</span>:seat.inHand&&seat.stack===0&&room.street!=="showdown"?<span>ALL IN</span>:null}</div>{seat.bet>0?<span className="seat-bet">{money(seat.bet)}</span>:null}{seat.leaveAfter?<small>Leaving after hand</small>:null}</>:<button disabled={me.seat>=0||!!elsewhere||busy||!buyInOk} onClick={()=>{if(buyInOk&&buyInCents!==null)action({type:"join",seat:i,buyIn:buyInCents});}}><span>+</span> Seat {i+1}</button>}</div>;})}<KickVotePopup vote={(room.pokerKickVote??null) as KickVote|null} now={clock} myPublicId={room.me.publicId} names={Object.fromEntries(room.chatNames.map(n=>[n.publicId,n.name]))} busy={kickBusy} onVote={(v,yes)=>kickCall({action:"vote",voteId:v.id,yes})}/>{kickError?<p role="status" style={{position:"fixed",left:12,bottom:12,zIndex:60,margin:0,padding:"8px 12px",borderRadius:8,background:"#1a1f26",color:"#fff",fontSize:13}}>{kickError}</p>:null}</div></PokerPlayerMenu>
 <div className="action-bar">{me.seat<0?<><div><strong>Pull up a chair.</strong><p>$100–{money(room.casinoLimits.pokerMaxBuyIn)} buy-in. Turn timeouts auto-fold. Five inactive hands forfeit your table chips.</p></div><label>BUY-IN <div className="input-wrap"><span>$</span><CasinoAmountInput aria-label="Buy-in dollars" min="100" max={Math.min(room.casinoLimits.pokerMaxBuyIn/100,Math.floor(me.wallet/100))} value={buyIn} onChange={setBuyIn}/></div></label></>:<><div><strong>{choices?"Your move.":mySeat?.inHand&&room.street!=="showdown"?"Hand in progress.":mySeat?.ready?"You’re ready.":room.street==="showdown"?"Nice hand.":"You’re at the table."}</strong><p>{choices?"60 seconds per turn. Countdown starts at 30 seconds remaining. Timeout auto-folds; your remaining stack stays yours.":mySeat?.inHand&&room.street!=="showdown"?"Cash out is unavailable until this hand finishes.":mySeat?.ready?"You can unready or cash out before the hand starts. After two minutes, unready players cash out. Two or more ready players start; a lone ready player becomes unready and keeps their seat and chips.":canReady?"Ready up to play, or cash out your stack to your wallet.":canCashOut?"Cash out now, or ready up once the next hand opens.":"Wait for this hand to finish before readying or cashing out."}</p></div><div className="action-buttons">{choices?<><button disabled={busy} className="muted-button" onClick={()=>action({type:"fold"})}>Fold</button><button disabled={busy} onClick={()=>action({type:choices.check?"check":"call"})}>{choices.check?"Check":"Call "+money(choices.toCall)}</button>{choices.raiseOpen?<><label className="raise-input"><span className="sr-only">Raise total dollars</span><span>$</span><CasinoAmountInput min={Math.ceil(Math.min(choices.minTo,choices.maxTo)/100)} max={Math.floor(choices.maxTo/100)} value={raise} onChange={setRaise}/></label><button className="primary" disabled={busy||!raiseOk} onClick={()=>{if(raiseOk&&raiseCents!==null)action({type:"raise",to:raiseCents});}}>{room.currentBet===0?"Bet":"Raise to"} {money(raiseCents??0)}</button><button disabled={busy||!isWholeCasinoAmount(choices.maxTo)} title={isWholeCasinoAmount(choices.maxTo)?undefined:"Raise totals must be whole dollars."} onClick={()=>{if(isWholeCasinoAmount(choices.maxTo))action({type:"raise",to:choices.maxTo});}}>All in</button></>:null}</>:canReady?<button disabled={busy} className="primary" onClick={()=>action({type:"ready"})}>Ready</button>:mySeat?.ready&&canCashOut?<button disabled={busy} onClick={()=>action({type:"unready"})}>Unready</button>:null}<button disabled={busy||!canCashOut} className="leave-button" onClick={()=>action({type:"leave"})}>Cash out {money(mySeat?.stack||0)}</button></div></>}</div></section></PokerTauntProvider><aside className="rail"><div><p className="eyebrow">TABLE TALK</p><h2>Every hand<br/>has a story.</h2></div>{room.payouts.length?<div className="winner-note">{room.payouts.map((p,i)=><p key={i}><strong>{room.seats[p.seat]?.name||"Player"} +{money(p.amount)}</strong><span>{p.description}</span></p>)}</div>:null}<ol className="hand-log" aria-label="Hand history">{room.log.length?room.log.map((entry,i)=><li key={room.log.length+"-"+i}>{entry}</li>):<li>The cards are ready. The friends are on their way.</li>}</ol><details className="rules"><summary>House rules</summary><p>$1 small blind, $2 big blind, $5 live UTG straddle with 3+ players. Heads-up is $1/$2. No rake.</p><p>60-second turns, with a countdown for the final 30 seconds. Timeout auto-folds without removing your seat or forfeiting your remaining stack. Five consecutive completed hands without playing also removes your seat and forfeits its chips. Refreshing does not reset the timer. Cash out whenever you are not in an active hand, even if ready.</p><p>All seated players not sitting out must press Ready, with at least two players. You can unready before a hand starts. Two minutes after the first Ready, unready players are unseated and all their chips return to their wallets. The hand starts with two or more ready players. A lone ready player stays seated with their chips and becomes unready. Ready again after each hand.</p><p>Black 78: a black 7 and a black 8 as your two hole cards beat every other hand at showdown, even a royal flush. Two Black 78 hands split eligible pots. Folding still forfeits the hand.</p><p>Minimum raise is the last full raise. Short all-ins do not immediately reopen betting. Side pots and split pots are automatic.</p></details></aside></div>:tab==="markets"?<Markets room={room} busy={busy} post={post}/>:tab==="roulette"?<Roulette room={room} busy={busy} post={post}/>:tab==="blackjack"?<Blackjack room={room} busy={busy} post={post}/>:tab==="standings"?<section className="standings"><p className="eyebrow">BRAGGING RIGHTS</p><h2>Who’s up?</h2><p>Cash, poker chips, spot holdings, and perpetual equity at the latest available prices.</p><table><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Total chips</th><th scope="col">Since joining</th></tr></thead><tbody>{room.leaderboard.map((m,i)=><tr key={m.publicId}><td>{String(i+1).padStart(2,"0")}</td><th scope="row">{m.name}{m.publicId===me.publicId?" (you)":""}</th><td>{money(m.netWorth)}</td><td className={m.pnl>=0?"positive":"negative"}>{signed(m.pnl)}</td></tr>)}</tbody></table></section>:<section className="access"><MarketSymbolSettings/><CasinoLimitSettings/><DoudizhuRateSettings/><LimitsControls room={room} busy={busy} post={post}/><PlayersList users={room.adminUsers} busy={busy} post={post} onRefresh={async signal=>{const response=await fetch("/api/room",{cache:"no-store",signal});const data=await response.json();if(!response.ok)throw new Error(data.error||"Players unavailable.");setRoom(current=>mergeRoom(current,data as PublicRoom));}}/><RiskControls room={room as unknown as AdminRoom} busy={busy} post={post}/></section>}
 </div>
 </main>;
}
