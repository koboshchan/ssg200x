"use client";
import {useEffect,useRef,type ReactNode} from "react";
import styles from "./in-play-navigation.module.css";
let seq=0;
export type ConfirmDialogProps={open:boolean;title:string;children?:ReactNode;confirmLabel:string;cancelLabel?:string;danger?:boolean;onConfirm:()=>void;onCancel:()=>void};
/** In-app replacement for window.confirm, same look as the leave-risk dialog. Cancel is focused first. */
export function ConfirmDialog({open,title,children,confirmLabel,cancelLabel="Cancel",danger,onConfirm,onCancel}:ConfirmDialogProps){
 const ref=useRef<HTMLDialogElement>(null),cancelRef=useRef<HTMLButtonElement>(null),id=useRef("confirm-dialog-"+(++seq)).current;
 useEffect(()=>{const d=ref.current;if(!d)return;if(open&&!d.open){d.showModal();cancelRef.current?.focus();}else if(!open&&d.open)d.close();},[open]);
 useEffect(()=>()=>{ref.current?.close();},[]);
 return <dialog ref={ref} className={styles.dialog} aria-labelledby={id+"-t"} aria-describedby={id+"-d"} onCancel={e=>{e.preventDefault();onCancel();}}>
  <h2 id={id+"-t"}>{title}</h2>
  <div id={id+"-d"} className={styles.body}>{children}</div>
  <div className={styles.actions}><button type="button" onClick={onConfirm} data-danger={danger?"true":undefined}>{confirmLabel}</button><button type="button" ref={cancelRef} className="primary" onClick={onCancel}>{cancelLabel}</button></div>
 </dialog>;
}
