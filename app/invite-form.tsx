"use client";
import {useState} from "react";
export default function InviteForm(){
 const [email,setEmail]=useState(""),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),[message,setMessage]=useState("");
 async function send(){setBusy(true);setMessage("");try{const response=await fetch("/api/invite",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email})}),data=await response.json();if(!response.ok)throw new Error(data.error||"Could not send invitation");setMessage("Invitation sent to "+data.email);setEmail("");setConfirm(false);}catch(e){setMessage(e instanceof Error?e.message:"Could not send invitation");}finally{setBusy(false);}}
 return <section><h3>Invite a friend</h3><form onSubmit={e=>{e.preventDefault();setConfirm(true);}}><label>Email address <input type="email" required maxLength={254} value={email} disabled={busy} onChange={e=>{setEmail(e.target.value);setConfirm(false);}}/></label> {confirm?<><p>Send a Clerk invitation email to {email}? They will still need your in-app approval.</p><button type="button" disabled={busy} className="primary" onClick={send}>Send invitation</button> <button type="button" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button></>:<button disabled={busy||!email}>Invite</button>}</form><p role="status">{message}</p></section>;
}
