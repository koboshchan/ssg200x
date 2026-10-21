"use client";
import {getTabHeaders} from "@/lib/tab-identity";
import {useCallback,useEffect,useState} from "react";
type Limits={rouletteMaxTotal:number;blackjackMaxHand:number;pokerMaxBuyIn:number;gamesMaxBet:number;revision:number};
const dollars=(cents:number)=>String(cents/100);
export default function CasinoLimitSettings(){
 const [limits,setLimits]=useState<Limits|null>(null),[hidden,setHidden]=useState(false),[error,setError]=useState(""),[busy,setBusy]=useState(false),[roulette,setRoulette]=useState(""),[blackjack,setBlackjack]=useState(""),[poker,setPoker]=useState(""),[games,setGames]=useState("");
 const load=useCallback(async()=>{
  try{const r=await fetch("/api/admin/casino-limits",{cache:"no-store"});
   if(r.status===403){setHidden(true);return;}
   const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Could not load limits.");
   setLimits(j.casinoLimits);setRoulette(dollars(j.casinoLimits.rouletteMaxTotal));setBlackjack(dollars(j.casinoLimits.blackjackMaxHand));setPoker(dollars(j.casinoLimits.pokerMaxBuyIn));setGames(dollars(j.casinoLimits.gamesMaxBet));
  }catch(e){setError(e instanceof Error?e.message:"Could not load limits.");}
 },[]);
 useEffect(()=>{void load();},[load]);
 async function save(e:React.FormEvent){
  e.preventDefault();if(!limits||busy)return;setError("");
  const r$=Number(roulette),b$=Number(blackjack),p$=Number(poker),g$=Number(games);
  if(![r$,b$,p$,g$].every(v=>Number.isInteger(v)&&v>=1&&v<=1_000_000)){setError("Limits must be whole dollars between $1 and $1,000,000.");return;}
  if(p$<100){setError("Poker max buy-in must be at least $100.");return;}
  setBusy(true);
  try{const r=await fetch("/api/admin/casino-limits",{method:"POST",headers:{"content-type":"application/json",...getTabHeaders()},body:JSON.stringify({rouletteMaxTotal:r$*100,blackjackMaxHand:b$*100,pokerMaxBuyIn:p$*100,gamesMaxBet:g$*100,expectedVersion:limits.revision})});
   const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"Could not save.");
   setLimits(j.casinoLimits);setRoulette(dollars(j.casinoLimits.rouletteMaxTotal));setBlackjack(dollars(j.casinoLimits.blackjackMaxHand));setPoker(dollars(j.casinoLimits.pokerMaxBuyIn));setGames(dollars(j.casinoLimits.gamesMaxBet));
  }catch(err){setError(err instanceof Error?err.message:"Could not save.");await load();}
  finally{setBusy(false);}
 }
 if(hidden)return null;
 return <form className="admin-block" onSubmit={save} aria-labelledby="casino-limits-title">
  <h2 id="casino-limits-title">Casino limits</h2>
  {!limits?<p role="status">Loading limits…</p>:<fieldset className="admin-set admin-fields" disabled={busy}>
   <label><span>Roulette max total bet per player per round ($)</span><input type="number" inputMode="numeric" min={1} max={1000000} step={1} value={roulette} onChange={e=>setRoulette(e.target.value)}/></label>
   <label><span>Blackjack max hand bet ($)</span><input type="number" inputMode="numeric" min={1} max={1000000} step={1} value={blackjack} onChange={e=>setBlackjack(e.target.value)}/></label>
   <label><span>Poker max buy-in per seat ($)</span><input type="number" inputMode="numeric" min={100} max={1000000} step={1} value={poker} onChange={e=>setPoker(e.target.value)}/></label>
   <label><span>Games max bet per game ($)</span><input type="number" inputMode="numeric" min={1} max={1000000} step={1} value={games} onChange={e=>setGames(e.target.value)}/></label>
   <p>Poker limits apply when buying in. Existing stacks and winnings are unchanged.</p>
   <button type="submit" className="primary">Save limits</button>
  </fieldset>}
  {error?<div className="error" role="alert">{error}<button type="button" aria-label="Dismiss error" onClick={()=>setError("")}>×</button></div>:null}
 </form>;
}
