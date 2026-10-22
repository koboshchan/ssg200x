"use client";
import {useEffect,useMemo,useState} from "react";
import {shouldHandleVoteKey} from "../lib/vote-key-guard";
import styles from "./seat-kick.module.css";

const RESULT_SHOW_MS=2600;
export type KickVote={id:string;targetPublicId:string;initiatorPublicId:string;eligiblePublicIds:string[];yesPublicIds:string[];startedAt:number;expiresAt:number;status:"active"|"passed"|"failed"|"cancelled"|"expired"};
export type KickPopupProps={vote:KickVote|null;now:number;myPublicId:string;names:Record<string,string>;busy:boolean;onVote:(vote:KickVote,yes:boolean)=>void};

/** CS2-style vote card sliding in from the left. Closes shortly after the result; one dismissal per vote id. */
export function KickVotePopup({vote,now,myPublicId,names,busy,onVote}:KickPopupProps){
 const [dismissed,setDismissed]=useState<string>("");
 const [resultAt,setResultAt]=useState<{id:string;at:number}|null>(null);
 const ended=!!vote&&vote.status!=="active";
 useEffect(()=>{if(vote&&ended&&resultAt?.id!==vote.id)setResultAt({id:vote.id,at:Date.now()});},[vote,ended,resultAt?.id]);
 useEffect(()=>{if(!vote||!ended)return;const t=window.setTimeout(()=>setDismissed(vote.id),RESULT_SHOW_MS);return()=>window.clearTimeout(t);},[vote,ended]);
 const eligible=!!vote&&vote.eligiblePublicIds.includes(myPublicId);
 const voted=!!vote&&vote.yesPublicIds.includes(myPublicId);
 const isTarget=!!vote&&vote.targetPublicId===myPublicId;
 const canAct=!!vote&&vote.status==="active"&&eligible&&!voted&&!busy;
 useEffect(()=>{
  if(!canAct||!vote)return;
  const key=(e:globalThis.KeyboardEvent)=>{
   if(!shouldHandleVoteKey(e))return;
   if(e.key==="F1"){e.preventDefault();onVote(vote,true);}else if(e.key==="F2"){e.preventDefault();onVote(vote,false);}
  };
  window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);
 },[canAct,vote,onVote]);
 const visible=!!vote&&dismissed!==vote.id&&(vote.status==="active"?(eligible||isTarget||vote.initiatorPublicId===myPublicId):(eligible||isTarget));
 const total=Math.max(1,vote?vote.expiresAt-vote.startedAt:30000),left=vote?Math.max(0,vote.expiresAt-now):0;
 const pct=Math.min(100,100*left/total),secs=Math.ceil(left/1000);
 const label=useMemo(()=>vote?(vote.status==="passed"?"Vote passed":vote.status==="failed"?"Vote failed":vote.status==="expired"?"Vote expired":vote.status==="cancelled"?"Vote cancelled":""):"",[vote]);
 if(!vote)return null;
 const eligibleTotal=vote.eligiblePublicIds.length+(vote.eligiblePublicIds.includes(vote.targetPublicId)?0:1),needed=Math.floor(eligibleTotal*0.51)+1;
 const target=names[vote.targetPublicId]||"a player",starter=names[vote.initiatorPublicId]||"A player";
 return <aside className={styles.popup+(visible?" "+styles.in:"")} aria-live="polite" aria-hidden={!visible} role="alertdialog" aria-label="Vote kick">
  <div className={styles.kicker}>VOTE KICK{vote.status==="active"?<span className={styles.count}>{secs}</span>:null}</div>
  {vote.status==="active"?<>
   <p className={styles.question}>{isTarget?"Players are voting to kick you":"Kick "+target+"?"}</p>
   <p className={styles.sub}>Started by {starter} · {vote.yesPublicIds.length} yes · {needed} needed of {eligibleTotal} (more than 51%, target counts as no)</p>
   <div className={styles.bar} aria-hidden><i style={{width:pct+"%"}}/></div>
   {isTarget?<p className={styles.sub}>Your vote is automatically NO.</p>
    :voted?<p className={styles.you}>You voted YES</p>
    :<div className={styles.buttons}><button type="button" className={styles.yes} disabled={!canAct} onClick={()=>onVote(vote,true)}><kbd>F1</kbd> Yes</button><button type="button" className={styles.no} disabled={!canAct} onClick={()=>onVote(vote,false)}><kbd>F2</kbd> No</button></div>}
  </>:<p className={styles.question}>{label}{vote.status==="passed"?" · "+target+" was removed":""}</p>}
 </aside>;
}
