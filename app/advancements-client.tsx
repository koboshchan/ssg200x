"use client";
import {useEffect,useState} from "react";
import {useLiveEvent} from "./live-provider";
import type {PublicRoom} from "../lib/public";
import type {AdvancementState} from "../lib/advancements-shared";
import {getTabHeaders} from "../lib/tab-identity";
import {CheckInRow} from "./check-in-banner";
import AdvancementsView from "./advancements-view";
export default function AdvancementsClient(){
 const [room,setRoom]=useState<Pick<PublicRoom,"version"|"advancements"|"checkIn">|null>(null),[error,setError]=useState(""),[claiming,setClaiming]=useState(false);
 useLiveEvent("room:state",(r:PublicRoom)=>setRoom(old=>old&&old.version>r.version?old:r));
 useEffect(()=>{const controller=new AbortController();fetch("/api/room",{cache:"no-store",signal:controller.signal}).then(async res=>{const r=await res.json();if(!res.ok)throw new Error(r.error||"Could not load advancements.");setRoom(old=>old&&old.version>r.version?old:r);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[]);
 async function claim(){setClaiming(true);setError("");try{const res=await fetch("/api/check-in",{method:"POST",headers:{"Content-Type":"application/json",...getTabHeaders()},body:JSON.stringify({type:"claim"})});const view=await res.json();if(!res.ok)throw Error(view.error||"Could not claim daily reward.");setRoom(old=>old?{...old,checkIn:view}:old);window.dispatchEvent(new Event("check-in:claimed"));}catch(e){setError((e as Error).message);}finally{setClaiming(false);}}
 if(!room)return <main className="game-main"><p role={error?"alert":"status"}>{error||"Loading advancements…"}</p></main>;
 return <><section className="check-in-page"><h2>Daily check-in · Day {room.checkIn.streak}</h2><p>{room.checkIn.claimed?"Claimed today":"Available today"} · Vancouver time</p><CheckInRow streak={room.checkIn.streak}/>{error?<p role="alert">{error}</p>:null}<button className="primary" disabled={claiming||room.checkIn.claimed} onClick={claim}>{room.checkIn.claimed?"Claimed today":"Claim $"+room.checkIn.reward/100}</button></section><AdvancementsView state={room.advancements as AdvancementState}/></>;
}
