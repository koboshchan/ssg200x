"use client";
import Performance from "./performance";
import {useRef,useEffect,useState} from "react";
import {ADVANCEMENTS,advancementCount,type AdvancementState} from "../../lib/advancements-shared";
import AdvancementsView,{AdvancementIcon} from "../advancements-view";
export default function AdvancementProfile({name,state,publicId}:{name:string;state:AdvancementState;publicId?:string}){
 const dialog=useRef<HTMLDialogElement>(null),[open,setOpen]=useState(false);
 useEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close();},[open]);
 const top=ADVANCEMENTS.map(a=>({...a,count:advancementCount(state,a.tier)})).filter(a=>a.count>0).sort((a,b)=>b.count-a.count||a.tier-b.tier).slice(0,3);
 return <><button className="adv-profile-name" onClick={()=>setOpen(true)} aria-label={"View "+name+"'s profile"}>{name}</button><span className="adv-mini-icons">{top.map(a=><span key={a.tier} title={a.name+" ×"+a.count}><AdvancementIcon icon={a.icon}/><small>×{a.count}</small></span>)}</span><dialog ref={dialog} className="adv-profile-dialog" aria-label={name+"'s profile"} onCancel={()=>setOpen(false)} onClick={e=>{if(e.target===dialog.current)setOpen(false);}}><div className="adv-profile-toolbar"><strong>{name}'s profile</strong><button onClick={()=>setOpen(false)} aria-label="Close profile">×</button></div>{open?<>{publicId?<Performance publicId={publicId}/>:null}<AdvancementsView state={state}/></>:null}</dialog></>;
}
