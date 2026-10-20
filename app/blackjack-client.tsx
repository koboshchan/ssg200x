"use client";
import {turnCountdown} from "@/lib/turn-timer";
import {useServerClock} from "./use-server-clock";
import {ROULETTE_CHIPS as denominations} from "@/lib/roulette-chips";
import styles from "./roulette.module.css";
import {useState} from "react";
import type {PublicRoom} from "@/lib/public";
const money=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:n%100===0?0:2}).format(n/100);
const suits:Record<string,string>={s:"♠",h:"♥",c:"♣",d:"♦"};
/* Expected PublicRoom.blackjack shape (adjust to the engine's real type when published). */
export type BjHand={cards:string[];bet:number;done?:boolean;result?:string;payout?:number;handName?:string|null};
export type BjSeat={name:string;publicId:string;isYou?:boolean;bet:number;idleDeadline?:number|null;hands:BjHand[]}|null;
export type BjTable={id:string;seats:BjSeat[];dealer:{cards:string[]};dealerHandName?:string|null;phase:"betting"|"playing"|"dealer"|"settled";round:number;deadline:number|null;turn:{seat:number;hand:number}|null;minBet:number;maxBet:number;legal?:{hit:boolean;stand:boolean;double:boolean;split:boolean}|null};
type Props={room:PublicRoom;busy:boolean;post:(path:string,body:object)=>Promise<void>};
export function total(cards:string[]){let t=0,aces=0;for(const c of cards){if(c==="?")continue;const r=c[0];if(r==="A"){aces++;t+=11;}else t+="TJQK".includes(r)?10:Number(r);}while(t>21&&aces){t-=10;aces--;}return t;}
function Card({value}:{value:string}){const back=value==="?";const red=!back&&["h","d"].includes(value.slice(-1));return <span aria-label={back?"Hidden card":value} className={"card small"+(back?" back":"")+(red?" red":"")}>{back?null:<><b>{value[0]==="T"?"10":value[0]}</b><i>{suits[value.slice(-1)]}</i></>}</span>;}
const MAX_CLICKS=1000;
export default function Blackjack({room,busy,post}:Props){
 const clock=useServerClock(room.serverNow);
 const bj=(room as unknown as {blackjack?:{tables:BjTable[]}}).blackjack;
 const tables=bj?.tables||[];
 const [sel,setSel]=useState(0),[chips,setChips]=useState<number[]>([]);
 const t=tables[sel];const cents=chips.reduce((a,c)=>a+c,0);
 if(!tables.length)return <section className="bj"><h2>Blackjack</h2><p className="empty">Blackjack tables are not available yet.</p></section>;
 const mine=t.seats.findIndex(s=>s?.isYou);
 const me=mine>=0?t.seats[mine]:null;
 const send=(body:object)=>post("/api/blackjack",{tableId:t.id,...body,requestId:crypto.randomUUID(),requestAt:Date.now()});
 const act=(type:"hit"|"stand"|"double"|"split")=>post("/api/blackjack",{tableId:t.id,type,round:t.round,deadline:t.deadline,requestId:crypto.randomUUID(),requestAt:Date.now()});
 const countdown=turnCountdown(t.deadline,clock);
 const myTurn=t.phase==="playing"&&t.turn?.seat===mine;
 return <section className="bj"><div className="market-heading"><div><h2>Blackjack</h2><p>6 decks, dealer stands on all 17s. Black 78 is the only special hand: a 7 and an 8, both black suits, as your first two cards (not after a split). It beats blackjack and pays 3:2; two Black 78s push. Blackjack pays 3:2. Five-card Charlie (21 or less) wins 1:1, including split hands, but loses to a dealer initial blackjack or Black 78. Bets {money(t.minBet)} to {money(t.maxBet)}. 100-second turns; timeout forfeits all your current bets to the house. Seats without a bet expire after 5 minutes of betting time; hands pause the idle clock.</p></div></div>
  <div className="symbol-tabs" role="group" aria-label="Blackjack tables">{tables.map((x,i)=><button key={x.id} aria-pressed={i===sel} onClick={()=>setSel(i)}>{x.id[0].toUpperCase()+x.id.slice(1)}</button>)}</div>
  <div className="bj-felt"><div className="bj-dealer"><small>Dealer{t.dealer.cards.length?" · "+total(t.dealer.cards):""}{t.dealerHandName?" · "+t.dealerHandName:""}</small><div className="hole">{t.dealer.cards.length?t.dealer.cards.map((c,i)=><Card key={i} value={c}/>):<span className="empty">Waiting for bets</span>}</div></div>
   <p className="table-message" role="status">{t.phase==="betting"?"Place your bets"+(t.deadline?" · "+Math.max(0,Math.ceil((t.deadline-clock)/1000))+"s":""):t.phase==="playing"?(t.turn?(t.seats[t.turn.seat]?.name||"Player")+" to act"+(countdown===null?"":" · "+countdown+"s"):""):t.phase==="dealer"?"Dealer plays":"Round over"}</p>
   <div className="bj-seats">{t.seats.map((s,i)=><div key={i} className={"bj-seat"+(s?.isYou?" you":"")+(t.turn?.seat===i?" acting":"")}>{s?<><strong>{s.name}{s.isYou?" (you)":""}</strong>{s.hands.map((h,j)=><div key={j} className="bj-hand"><div className="hole">{h.cards.map((c,k)=><Card key={k} value={c}/>)}</div><small>{h.cards.length?total(h.cards)+" · ":""}{money(h.bet)}{h.handName?" · "+h.handName:""}{h.result?" · "+h.result:""}</small></div>)}{t.phase==="betting"&&s.bet===0&&turnCountdown(s.idleDeadline??null,clock,300_000)!==null?<small>Bet within {turnCountdown(s.idleDeadline??null,clock,300_000)}s to keep seat</small>:null}{!s.hands.length&&s.bet>0?<small>Bet {money(s.bet)}</small>:null}</>:<button disabled={busy||mine>=0} onClick={()=>send({type:"join",seat:i})}>Sit at seat {i+1}</button>}</div>)}</div></div>
  <div className="action-bar">{me?<><div><strong>{myTurn?"Your move.":t.phase==="betting"?"Place your bet.":"Waiting."}</strong></div><div className="action-buttons">{t.phase==="betting"?<><div className={"bj-chips "+styles.roulette}><div className={styles.chipPicker} role="group" aria-label="Chip value">{denominations.map(d=>{const v=d.value*100;return <button key={d.value} type="button" aria-label={money(v)+" chip"} disabled={busy||chips.length>=MAX_CLICKS||cents+v>t.maxBet} className={styles.chip} style={{"--chip-color":d.color} as React.CSSProperties} onClick={()=>setChips(c=>c.length>=MAX_CLICKS?c:[...c,v])}><span>{d.value}</span></button>;})}</div><div className="bj-chip-row"><div className={styles.total}><span>Total bet</span><strong data-testid="bj-total">{money(cents)}</strong></div><span className="bj-placed" data-testid="bj-placed">{chips.length?denominations.filter(d=>chips.includes(d.value*100)).map(d=>chips.filter(c=>c===d.value*100).length+" × "+money(d.value*100)).join(" + "):"No chips placed"}</span><button type="button" disabled={busy||!chips.length} onClick={()=>setChips([])}>Clear</button></div></div><button className="primary" disabled={busy||!chips.length||cents<t.minBet||cents>t.maxBet} onClick={()=>{if(chips.length&&!busy){send({type:"bet",amount:cents,chips});setChips([]);}}}>Bet {money(cents)}</button></>:null}{myTurn&&t.legal?<>{(["hit","stand","double","split"] as const).map(a=><button key={a} className={a==="hit"?"primary":""} disabled={busy||!t.legal![a]} onClick={()=>act(a)}>{a[0].toUpperCase()+a.slice(1)}</button>)}</>:null}<button className="leave-button" disabled={busy} onClick={()=>send({type:"leave"})}>Leave table</button></div></>:<div><strong>Pick a seat.</strong><p>Up to 6 players per table.</p></div>}</div></section>;
}
