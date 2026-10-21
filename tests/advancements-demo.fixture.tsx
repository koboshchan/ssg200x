import "../app/advancements.css";
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import AdvancementsView,{AdvancementToast} from "../app/advancements-view";
import {ADVANCEMENTS,type AdvancementState} from "../lib/advancements-shared";
function Demo(){
 const [state,setState]=useState<AdvancementState>({streak:6,lastRound:6,unlocked:{}}),[toast,setToast]=useState<number[]>([]);
 function loss(){setState(old=>{const streak=old.streak+1,unlocked={...old.unlocked},fresh:number[]=[];for(const a of ADVANCEMENTS)if(streak>=a.tier&&unlocked[a.tier]===undefined){unlocked[a.tier]=Date.now();fresh.push(a.tier);}setToast(fresh);return {streak,lastRound:old.lastRound+1,unlocked};});}
 return <><header className="mast"><a href="/" className="wordmark">ssg200x</a><nav className="nav-links"><a href="#">Poker</a><a href="#">Blackjack</a><a href="#">Roulette</a><a href="#">Markets</a><a href="#">Wallet</a><a href="#">Leaderboard</a><a href="/" aria-current="page">Advancements</a></nav></header><section style={{maxWidth:952,margin:"20px auto 0",padding:"12px 20px",borderBottom:"1px solid var(--line)",display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}><span style={{fontSize:12,color:"var(--muted)",marginRight:"auto"}}>Interactive preview · simulated rounds, no real account</span><button onClick={loss}>Lose a round</button><button onClick={()=>{setState(s=>({...s,streak:0}));setToast([]);}}>Win a round</button><button onClick={()=>{setState({streak:6,lastRound:6,unlocked:{}});setToast([]);}}>Reset preview</button></section><AdvancementsView state={state}/><AdvancementToast tiers={toast} onDismiss={()=>setToast([])}/></>;
}
createRoot(document.getElementById("root")!).render(<Demo/>);
