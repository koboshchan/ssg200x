"use client";
import {useState} from "react";

export default function ProfileAvatar({imageUrl,initials}:{imageUrl?:string;initials:string}){
 const [failedUrl,setFailedUrl]=useState<string|null>(null);
 // Only Clerk-hosted HTTPS images can leave this public page.
 let safeUrl:string|undefined;
 try{
  const url=new URL(imageUrl||"");
  if(url.protocol==="https:"&&url.hostname==="img.clerk.com"&&!url.username&&!url.password)safeUrl=url.href;
 }catch{}
 return <span className="avatar" aria-hidden="true">{safeUrl&&failedUrl!==safeUrl?
  // Clerk URLs are external and user-specific, not Next image-optimizer inputs.
  // eslint-disable-next-line @next/next/no-img-element
  <img src={safeUrl} alt="" width={32} height={32} referrerPolicy="no-referrer" onError={()=>setFailedUrl(safeUrl!)} style={{width:"100%",height:"100%",borderRadius:"50%",objectFit:"cover"}}/>:
  initials}</span>;
}
