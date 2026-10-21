"use client";
import {useEffect,useRef,useState} from "react";
import type {PublicRoom} from "../lib/public";
import {AdvancementToast} from "./advancements-view";
export default function AdvancementAnnouncement({subscribe}:{subscribe:(event:string,handler:(room:PublicRoom)=>void)=>()=>void}){
 const seen=useRef<Set<number>|null>(null),version=useRef(-1);
 const [tiers,setTiers]=useState<number[]>([]);
 useEffect(()=>subscribe("room:state",room=>{
  if(room.version<version.current)return;version.current=room.version;
  const unlocked=Object.keys(room.advancements?.unlocked??{}).map(Number);
  if(!seen.current){seen.current=new Set(unlocked);return;}
  const fresh=unlocked.filter(t=>!seen.current!.has(t));unlocked.forEach(t=>seen.current!.add(t));
  if(fresh.length)setTiers(current=>[...new Set([...current,...fresh])]);
 }),[subscribe]);
 return <AdvancementToast tiers={tiers} onDismiss={()=>setTiers([])}/>;
}
