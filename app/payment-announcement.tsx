"use client";
import {useEffect,useRef,useState} from "react";
import type {PublicRoom} from "../lib/public";
import {MoneyBanner,type MoneyNotice} from "./money-banner";
export default function PaymentAnnouncement({subscribe}:{subscribe:(event:string,handler:(r:PublicRoom)=>void)=>()=>void}){
 const seen=useRef<Set<string>|null>(null),[queue,setQueue]=useState<MoneyNotice[]>([]);
 useEffect(()=>subscribe("room:state",room=>{
  const list=room.receivedPayments??[];
  if(!seen.current){seen.current=new Set(list.map(p=>p.id));return;}
  const fresh=list.filter(p=>!seen.current!.has(p.id));fresh.forEach(p=>seen.current!.add(p.id));
  if(fresh.length)setQueue(q=>[...q,...fresh.reverse().map(p=>({...p,kind:"payment" as const}))]);
 }),[subscribe]);
 const current=queue[0];
 useEffect(()=>{if(!current)return;const timer=setTimeout(()=>setQueue(q=>q.slice(1)),4000);return()=>clearTimeout(timer);},[current]);
 return current?<MoneyBanner key={current.id} notice={current}/>:null;
}
