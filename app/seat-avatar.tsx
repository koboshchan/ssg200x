"use client";
import {useState} from "react";

/** Clerk avatar for a table seat. Only Clerk-hosted HTTPS images are allowed; a missing, unsafe or failed image falls back to initials. */
export function seatInitials(name:string){return Array.from(name.trim().split(/\s+/).map(w=>Array.from(w)[0]||"").join("")).slice(0,2).join("").toUpperCase()||"?";}
export default function SeatAvatar({name,imageUrl,size=28}:{name:string;imageUrl?:string|null;size?:number}){
 const [failed,setFailed]=useState<string|null>(null);
 let safe:string|undefined;
 try{const u=new URL(imageUrl||"");if(u.protocol==="https:"&&u.hostname==="img.clerk.com"&&!u.username&&!u.password)safe=u.href;}catch{}
 const show=!!safe&&failed!==safe;
 return <span className="avatar seat-avatar" aria-hidden="true" style={{width:size,height:size,flex:"0 0 "+size+"px",overflow:"hidden",display:"inline-grid",placeItems:"center",borderRadius:"50%",fontSize:Math.round(size*.42)}}>
  {show?/* eslint-disable-next-line @next/next/no-img-element */<img src={safe} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(safe!)} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>:seatInitials(name)}
 </span>;
}
