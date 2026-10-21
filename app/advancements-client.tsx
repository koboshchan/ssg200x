"use client";
import {useEffect,useState} from "react";
import {useLiveEvent} from "./live-provider";
import type {PublicRoom} from "../lib/public";
import type {AdvancementState} from "../lib/advancements-shared";
import AdvancementsView from "./advancements-view";
export default function AdvancementsClient(){
 const [room,setRoom]=useState<Pick<PublicRoom,"version"|"advancements">|null>(null),[error,setError]=useState("");
 useLiveEvent("room:state",(r:PublicRoom)=>setRoom(old=>old&&old.version>r.version?old:r));
 useEffect(()=>{const controller=new AbortController();fetch("/api/room",{cache:"no-store",signal:controller.signal}).then(async res=>{const r=await res.json();if(!res.ok)throw new Error(r.error||"Could not load advancements.");setRoom(old=>old&&old.version>r.version?old:r);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[]);
 if(!room)return <main className="game-main"><p role={error?"alert":"status"}>{error||"Loading advancements…"}</p></main>;
 return <AdvancementsView state={room.advancements as AdvancementState}/>;
}
