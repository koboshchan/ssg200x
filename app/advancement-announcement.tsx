"use client";
import {ADVANCEMENTS,advancementCount,ADVANCEMENT_REWARDS_CENTS} from "../lib/advancements-shared";
import {useCallback,useEffect,useRef,useState} from "react";
import type {PublicRoom} from "../lib/public";
import {AdvancementToast} from "./advancements-view";
export default function AdvancementAnnouncement({subscribe}:{subscribe:(event:string,handler:(room:PublicRoom)=>void)=>()=>void}){
 const seen=useRef<Map<number,number>|null>(null),version=useRef(-1);
 const [tiers,setTiers]=useState<{tier:number;reward:number}[]>([]);
 useEffect(()=>subscribe("room:state",room=>{
  if(!room.advancements)return;
  if(room.version<version.current)return;version.current=room.version;
  const counts=new Map(ADVANCEMENTS.map(a=>[a.tier,advancementCount(room.advancements,a.tier)]));
  if(!seen.current){seen.current=counts;return;}
  const fresh:{tier:number;reward:number}[]=[];
  for(const [tier,count] of counts){const previous=seen.current.get(tier)??0;for(let earn=previous+1;earn<=count;earn++)fresh.push({tier,reward:earn===1?ADVANCEMENT_REWARDS_CENTS[tier]:0});}
  seen.current=counts;if(fresh.length)setTiers(current=>[...current,...fresh]);
 }),[subscribe]);
 const dismiss=useCallback(()=>setTiers(q=>q.slice(1)),[]);
 return tiers[0]?<AdvancementToast key={tiers.length+":"+tiers[0].tier} tiers={[tiers[0].tier]} reward={tiers[0].reward} onDismiss={dismiss}/>:null;
}
