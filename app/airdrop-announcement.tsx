"use client";
import {MoneyBanner} from "./money-banner";
import {useEffect,useState} from "react";
import {AIRDROP_EVENT,type AirdropEvent} from "../runtime/airdrop-events.mjs";
import "./airdrop-announcement.css";

export function airdropMessage(amount:number){
 return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(amount/100).replace(/\.00$/,"")+" airdropped to everyone";
}
type Subscribe=(event:string,handler:(payload:AirdropEvent)=>void)=>()=>void;
export default function AirdropAnnouncement({subscribe}:{subscribe:Subscribe}){
 const [queue,setQueue]=useState<AirdropEvent[]>([]);
 useEffect(()=>subscribe(AIRDROP_EVENT,event=>setQueue(q=>[...q,event])),[subscribe]);
 const current=queue[0];
 useEffect(()=>{
  if(!current)return;
  const timer=setTimeout(()=>setQueue(q=>q.filter(event=>event.id!==current.id)),3250);
  return()=>clearTimeout(timer);
 },[current]);
 return <div role="status" aria-live="polite" aria-atomic="true" className="airdrop-status">
  {current?<Notice key={current.id} event={current}/>:null}
 </div>;
}
function Notice({event}:{event:AirdropEvent}){return <MoneyBanner notice={{...event,kind:"airdrop"}}/>;}
