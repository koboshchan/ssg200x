"use client";
import {useState} from "react";
import type {PublicRoom} from "@/lib/public";
const money=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:n%100===0?0:2}).format(n/100);
const suits:Record<string,string>={s:"♠",h:"♥",c:"♣",d:"♦"};
/* Expected PublicRoom.blackjack shape (adjust to the engine's real type when published). */
export type BjHand={cards:string[];bet:number;done?:boolean;result?:string;payout?:number};
export type BjSeat={name:string;publicId:string;isYou?:boolean;bet:number;hands:BjHand[]}|null;
export type BjTable={id:string;seats:BjSeat[];dealer:{cards:string[]};phase:"betting"|"playing"|"dealer"|"settled";round:number;deadline:number|null;turn:{seat:number;hand:number}|null;minBet:number;maxBet:number;legal?:{hit:boolean;stand:boolean;double:boolean;split:boolean}|null};
type Props={room:PublicRoom;busy:boolean;post:(path:string,body:object)=>Promise<void>};
export function total(cards:string[]){let t=0,aces=0;for(const c of cards){if(c==="?")continue;const r=c[0];if(r==="A"){aces++;t+=11;}else t+="TJQK".includes(r)?10:Number(r);}while(t>21&&aces){t-=10;aces--;}return t;}
function Card({value}:{value:string}){const back=value==="?";const red=!back&&["h","d"].includes(value.slice(-1));return <span aria-label={back?"Hidden card":value} className={"card small"+(back?" back":"")+(red?" red":"")}>{back?null:<><b>{value[0]==="T"?"10":value[0]}</b><i>{suits[value.slice(-1)]}</i></>}</span>;}
export default function Blackjack({room,busy,post}:Props){
 const bj=(room as unknown as {blackjack?:{tables:BjTable[]}}).blackjack;
 const tables=bj?.tables||[];
 const [sel,setSel]=useState(0),[bet,setBet]=useState("10");
 const t=tables[sel];const cents=Math.round(Number(bet)*100),betOk=Number.isSafeInteger(cents)&&cents%2===0;
 if(!tables.length)return <section className="bj"><h2>Blackjack</h2><p className="empty">Blackjack tables are not available yet.</p></section>;
 const mine=t.seats.findIndex(s=>s?.isYou);
 const me=mine>=0?t.seats[mine]:null;
 const send=(body:object)=>post("/api/blackjack",{tableId:t.id,...body,requestId:crypto.randomUUID(),requestAt:Date.now()});
 const act=(type:"hit"|"stand"|"double"|"split")=>post("/api/blackjack",{tableId:t.id,type,round:t.round,deadline:t.deadline,requestId:crypto.randomUUID(),requestAt:Date.now()});
 const myTurn=t.phase==="playing"&&t.turn?.seat===mine;
 return <section className="bj"><div className="market-heading"><div><h2>Blackjack</h2><p>6 decks, dealer stands on all 17s, blackjack pays 3:2. Bets {money(t.minBet)} to {money(t.maxBet)}.</p></div></div>
  <div className="symbol-tabs" role="group" aria-label="Blackjack tables">{tables.map((x,i)=><button key={x.id} aria-pressed={i===sel} onClick={()=>setSel(i)}>{x.id[0].toUpperCase()+x.id.slice(1)}</button>)}</div>
  <div className="bj-felt"><div className="bj-dealer"><small>Dealer{t.dealer.cards.length?" · "+total(t.dealer.cards):""}</small><div className="hole">{t.dealer.cards.length?t.dealer.cards.map((c,i)=><Card key={i} value={c}/>):<span className="empty">Waiting for bets</span>}</div></div>
   <p className="table-message" role="status">{t.phase==="betting"?"Place your bets"+(t.deadline?" · "+Math.max(0,Math.ceil((t.deadline-room.serverNow)/1000))+"s":""):t.phase==="playing"?(t.turn?(t.seats[t.turn.seat]?.name||"Player")+" to act":""):t.phase==="dealer"?"Dealer plays":"Round over"}</p>
   <div className="bj-seats">{t.seats.map((s,i)=><div key={i} className={"bj-seat"+(s?.isYou?" you":"")+(t.turn?.seat===i?" acting":"")}>{s?<><strong>{s.name}{s.isYou?" (you)":""}</strong>{s.hands.map((h,j)=><div key={j} className="bj-hand"><div className="hole">{h.cards.map((c,k)=><Card key={k} value={c}/>)}</div><small>{h.cards.length?total(h.cards)+" · ":""}{money(h.bet)}{h.result?" · "+h.result:""}</small></div>)}{!s.hands.length&&s.bet>0?<small>Bet {money(s.bet)}</small>:null}</>:<button disabled={busy||mine>=0} onClick={()=>send({type:"join",seat:i})}>Sit at seat {i+1}</button>}</div>)}</div></div>
  <div className="action-bar">{me?<><div><strong>{myTurn?"Your move.":t.phase==="betting"?"Place your bet.":"Waiting."}</strong></div><div className="action-buttons">{t.phase==="betting"?<><label className="raise-input"><span className="sr-only">Bet in dollars</span><span>$</span><input type="number" min={t.minBet/100} max={t.maxBet/100} step="1" value={bet} onChange={e=>setBet(e.target.value)}/></label><button className="primary" disabled={busy||!betOk||cents<t.minBet||cents>t.maxBet} onClick={()=>send({type:"bet",amount:Math.round(Number(bet)*100)})}>Bet {money(Math.round(Number(bet||0)*100))}</button></>:null}{myTurn&&t.legal?<>{(["hit","stand","double","split"] as const).map(a=><button key={a} className={a==="hit"?"primary":""} disabled={busy||!t.legal![a]} onClick={()=>act(a)}>{a[0].toUpperCase()+a.slice(1)}</button>)}</>:null}<button className="leave-button" disabled={busy} onClick={()=>send({type:"leave"})}>Leave table</button></div></>:<div><strong>Pick a seat.</strong><p>Up to 6 players per table.</p></div>}</div></section>;
}
