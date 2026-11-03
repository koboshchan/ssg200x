"use client";
export default function ErrorNote({message,onDismiss}:{message:string;onDismiss:()=>void}){
 return message?<div className="error" role="alert">{message}<button type="button" aria-label="Dismiss error" onClick={onDismiss}>×</button></div>:null;
}
