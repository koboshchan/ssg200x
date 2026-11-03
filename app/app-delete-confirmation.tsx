"use client";
import {useEffect,useId,useRef} from "react";
/** Inline confirmation, not a modal: keep the rest of the page accessible. */
export default function AppDeleteConfirmation({name,busy,onCancel,onDelete}:{name:string;busy:boolean;onCancel:()=>void;onDelete:()=>void}){
 const id=useId(),cancel=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  const previous=document.activeElement;
  cancel.current?.focus();
  return ()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};
 },[]);
 return <div className="app-actions" role="group" aria-labelledby={id+"title"} aria-describedby={id+"detail"} aria-busy={busy} onKeyDown={e=>{if(e.key==="Escape"&&!busy){e.preventDefault();e.stopPropagation();onCancel();}}}>
  <strong id={id+"title"}>Delete {name}?</strong>
  <span id={id+"detail"}>Linked users are disconnected. New charges and rewards stop; eligible refunds of earlier charges can still arrive. This cannot be undone.</span>
  <button ref={cancel} type="button" disabled={busy} onClick={onCancel}>Keep app</button>
  <button type="button" className="admin-remove" disabled={busy} onClick={onDelete}>{busy?"Deleting…":"Delete app permanently"}</button>
 </div>;
}
