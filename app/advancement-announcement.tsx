"use client";
import {ADVANCEMENTS,advancementCount} from "../lib/advancements-shared";
import {useEffect,useRef,useState} from "react";
import type {PublicRoom} from "../lib/public";
import {AdvancementToast} from "./advancements-view";
export default function AdvancementAnnouncement({subscribe}:{subscribe:(event:string,handler:(room:PublicRoom)=>void)=>()=>void}){
 const seen=useRef<Map<number,number>|null>(null),version=useRef(-1);
 const [tiers,setTiers]=useState<number[]>([]);
 useEffect(()=>subscribe("room:state",room=>{
  if(room.version<version.current)return;version.current=room.version;
  const counts=new Map(ADVANCEMENTS.map(a=>[a.tier,advancementCount(room.advancements,a.tier)]));
  if(!seen.current){seen.current=counts;return;}
  const fresh=[...counts].filter(([tier,count])=>count>(seen.current!.get(tier)??0)).map(([tier])=>tier);seen.current=counts;
  if(fresh.length)setTiers(current=>[...new Set([...current,...fresh])]);
 }),[subscribe]);
 return <AdvancementToast tiers={tiers} onDismiss={()=>setTiers([])}/>;
}
