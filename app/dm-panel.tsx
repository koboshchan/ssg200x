"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {useUser} from "@clerk/nextjs";
import {useLive,useLiveEvent} from "./live-provider";
import {indexedDbStore,getDmPin,putDmPin} from "@/lib/chat-store";
import {MAX_TEXT_BYTES,type Identity} from "@/lib/chat-crypto";
import {sealDm,openDm,pinOf,pinState,dmFingerprint,type DmWire,type DmHistoryMessage,type DmPin} from "@/lib/dm-crypto";
import {inConversation,historyPinState,mergeRows,rowKey,dmError,scope,pendingKey,pendingPrefix,type DmRow,type DmLookupPeer} from "@/lib/dm-view";

type Thread={userId:string;username:string;blocked:boolean;updatedAt:number};
type Conv={peer:DmLookupPeer;pin:DmPin|undefined;changed:boolean;fp:string;oldFp:string;blocked:boolean};
const time=(ts:number)=>new Date(ts).toLocaleString([],{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
const code=(e:unknown)=>e instanceof Error?e.message:"unavailable";

export default function DmPanel({phase,goSetup}:{phase:string;goSetup:()=>void}){
 const {user}=useUser(),live=useLive(),me=user?.id;
 const [idState,setIdState]=useState<{owner:string;id:Identity|null}|undefined>(undefined);
 // An identity loaded for another account is never used.
 const identity=idState&&idState.owner===me?idState.id:undefined;
 const [username,setUsername]=useState<string|null>(null),[copied,setCopied]=useState(false);
 const [threads,setThreads]=useState<Thread[]>([]),[conv,setConv]=useState<Conv|null>(null),[rows,setRows]=useState<DmRow[]>([]);
 const [cursor,setCursorState]=useState<string|null>(null),[find,setFind]=useState(""),[err,setErr]=useState<string|null>(null),[busy,setBusy]=useState(false),[text,setText]=useState("");
 const convRef=useRef<Conv|null>(null),identityRef=useRef<Identity|null|undefined>(undefined),meRef=useRef(me);
 const pending=useRef(new Map<string,{wire:DmWire;text:string;ts:number}>());
 const acct=useRef(scope()),epoch=useRef(scope()),cursorRef=useRef<string|null>(null),firstLoaded=useRef(false);
 const loading=useRef<{ep:number}|null>(null),again=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),list=useRef<HTMLDivElement>(null);
 convRef.current=conv;identityRef.current=identity;meRef.current=me;
 const {request,connection}=live;
 const setCursor=(c:string|null)=>{cursorRef.current=c;setCursorState(c);};
 // Starting a new conversation context invalidates every in-flight operation for the old one.
 const resetConv=()=>{const ep=epoch.current.next();loading.current=null;again.current=false;firstLoaded.current=false;setRows([]);setCursor(null);setText("");return ep;};

 useEffect(()=>{
  acct.current.next();epoch.current.next();loading.current=null;again.current=false;clearTimeout(timer.current);
  pending.current.clear();setConv(null);setRows([]);setCursor(null);setThreads([]);setUsername(null);setErr(null);setText("");setBusy(false);
  if(!me){setIdState(undefined);return;}
  const a=acct.current.value;let dead=false;
  indexedDbStore().getIdentity(me).then(i=>{if(!dead&&acct.current.valid(a))setIdState({owner:me,id:i??null});}).catch(()=>{if(!dead&&acct.current.valid(a))setIdState({owner:me,id:null});});
  return()=>{dead=true;};
 },[me]);
 useEffect(()=>{
  if(!me)return;const a=acct.current.value;let dead=false;
  // No chat identity exists while setup or recovery is showing (e.g. after an admin reset): drop the old one and anything unsent.
  if(phase==='setup'||phase==='recover'||phase==='words'){epoch.current.next();loading.current=null;again.current=false;pending.current.clear();setIdState({owner:me,id:null});setConv(null);setRows([]);setCursor(null);setText('');}
  indexedDbStore().getIdentity(me).then(i=>{if(!dead&&acct.current.valid(a))setIdState({owner:me,id:i??null});}).catch(()=>{if(!dead&&acct.current.valid(a))setIdState({owner:me,id:null});});
  return()=>{dead=true;};
 },[phase]);// eslint-disable-line react-hooks/exhaustive-deps

 const loadThreads=useCallback(async()=>{
  const a=acct.current.value;
  try{const r=await request("dm:threads",{v:1});if(acct.current.valid(a))setThreads(Array.isArray(r.threads)?r.threads:[]);}
  catch(e){if(acct.current.valid(a))setErr(dmError(code(e)));}
 },[request]);
 const decryptAll=useCallback(async(c:Conv,msgs:DmHistoryMessage[],id:Identity,user:string):Promise<DmRow[]>=>{
  const out:DmRow[]=[];
  for(const m of msgs){
   const mine=m.senderUserId===user,base={id:m.id,mine,ts:m.serverTs,cursor:m.cursor};
   if(!inConversation(m,user,c.peer.userId)){out.push({...base,status:"invalid"});continue;}
   // Check the keys on this message against the pin before touching ciphertext.
   if(c.changed||historyPinState(c.pin,m,user)!=="same"){out.push({...base,status:"changed"});continue;}
   const o=await openDm(id,user,m);
   out.push(o.ok?{...base,status:"ok",text:o.text}:{...base,status:o.reason==="wrong_recipient"||o.reason==="decrypt"?"unreadable":"invalid"});
  }
  return out;
 },[]);
 const refresh=useCallback(async(more?:boolean)=>{
  const c=convRef.current,id=identityRef.current,user=meRef.current;if(!c||!id||!user)return;
  const ep=epoch.current.value,a=acct.current.value;
  if(loading.current&&loading.current.ep===ep){again.current=true;return;}
  const mine={ep};loading.current=mine;
  const valid=()=>epoch.current.valid(ep)&&acct.current.valid(a);
  try{
   const before=more?cursorRef.current:null;
   if(more&&!before)return;
   const r=await request("dm:history",{v:1,userId:c.peer.userId,limit:50,...(before?{before}:{})});
   if(!valid())return;
   const decoded=await decryptAll(c,Array.isArray(r.messages)?r.messages:[],id,user);
   if(!valid())return;
   setRows(cur=>mergeRows(cur,decoded));
   // Only the first page and explicit "load earlier" move the cursor.
   if(more||!firstLoaded.current){setCursor(r.nextCursor??null);firstLoaded.current=true;}
   setConv(cur=>cur&&cur.peer.userId===c.peer.userId&&cur.blocked!==!!r.blocked?{...cur,blocked:!!r.blocked}:cur);
  }catch(e){if(valid())setErr(dmError(code(e)));}
  finally{
   // Only clear the guard we set; a newer conversation may own it now.
   if(loading.current===mine){loading.current=null;if(again.current){again.current=false;void refreshRef.current();}}
  }
 },[request,decryptAll]);
 const refreshRef=useRef(refresh);refreshRef.current=refresh;

 useEffect(()=>{
  if(!me||connection!=="connected")return;
  const a=acct.current.value;
  request("dm:profile",{v:1}).then(r=>{if(acct.current.valid(a))setUsername(typeof r.username==="string"?r.username:null);}).catch(()=>{});
  void loadThreads();
 },[me,connection,request,loadThreads]);
 // One debounced requery per burst of hints. No polling.
 useLiveEvent("dm:changed",()=>{clearTimeout(timer.current);timer.current=setTimeout(()=>{void loadThreads();void refreshRef.current();},400);});
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 useEffect(()=>{if(conv&&identity&&connection==="connected"){void refresh();}},[conv?.peer.userId,conv?.changed,identity,connection]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{const el=list.current;if(el&&rows.length)el.scrollTop=el.scrollHeight;},[rows.length]);

 const open=async(name:string)=>{
  const user=me;if(!user)return;
  const clean=name.trim().replace(/^@/,"");if(!clean)return;
  const ep=epoch.current.next(),a=acct.current.value;
  const valid=()=>epoch.current.valid(ep)&&acct.current.valid(a);
  setBusy(true);setErr(null);
  try{
   const r=await request("dm:lookup",{v:1,username:clean});
   if(!valid())return;
   const p=r.peer as DmLookupPeer|null;
   if(!p){setErr("No one has that exact username.");return;}
   if(p.userId===user){setErr("That's your own username.");return;}
   let pin=await getDmPin(user,p.userId),changed=false,oldFp="";
   if(!valid())return;
   if(!pin){pin=pinOf(p);await putDmPin(user,p.userId,pin);} // first lookup pins
   else if(pinState(pin,pinOf(p))==="changed"){changed=true;oldFp=await dmFingerprint(p.userId,pin);}
   const fp=await dmFingerprint(p.userId,p);
   if(!valid())return;
   const blocked=threads.find(t=>t.userId===p.userId)?.blocked??false;
   setBusy(false);
   resetConv();
   // resetConv bumped the epoch; the effect on conv drives the first load.
   setConv({peer:{...p,username:p.username||clean},pin,changed,fp,oldFp,blocked});
   const restored=[...pending.current.entries()].filter(([k])=>k.startsWith(pendingPrefix(user,p.userId))).map(([,v])=>({id:v.wire.id,mine:true,ts:v.ts,status:"failed" as const,text:v.text}));
   if(restored.length)setRows(restored);
   setFind("");
  }catch(e){if(valid())setErr(dmError(code(e)));}
  finally{if(epoch.current.valid(ep))setBusy(false);}
 };
 const trust=async()=>{
  const user=me,c=convRef.current;if(!user||!c)return;
  const pin=pinOf(c.peer),a=acct.current.value,ep=epoch.current.value,pid=c.peer.userId;
  const ok=()=>acct.current.valid(a)&&epoch.current.valid(ep)&&convRef.current?.peer.userId===pid;
  try{
   await putDmPin(user,pid,pin);
   if(!ok())return;
   resetConv();
   setConv({...c,pin,changed:false,oldFp:""});
  }catch(e){if(ok())setErr(dmError(code(e)));}
 };
 const send=async(retryId?:string)=>{
  const user=me,c=convRef.current,id=identityRef.current;
  if(!user||!c||!id||c.changed||c.blocked)return;
  const ep=epoch.current.value,a=acct.current.value,pid=c.peer.userId;
  const valid=()=>epoch.current.valid(ep)&&acct.current.valid(a)&&convRef.current?.peer.userId===pid;
  let wid=retryId;
  try{
   let entry=retryId?pending.current.get(pendingKey(user,pid,retryId)):undefined;
   if(retryId&&!entry)return;
   if(!entry){
    const body=text;
    if(!body.trim()||new TextEncoder().encode(body).length>MAX_TEXT_BYTES)return;
    const w=await sealDm(id,user,c.peer,body);
    if(!valid())return;
    entry={wire:w,text:body,ts:Date.now()};pending.current.set(pendingKey(user,pid,w.id),entry);
    wid=w.id;setText("");
    setRows(cur=>mergeRows(cur,[{id:w.id,mine:true,ts:entry!.ts,status:"pending",text:body}]));
   }else setRows(cur=>cur.map(r=>r.mine&&r.id===retryId?{...r,status:"pending"}:r));
   const r=await request("dm:send",entry.wire);
   pending.current.delete(pendingKey(user,pid,entry.wire.id));
   if(!valid())return;
   const decoded=await decryptAll(c,[r.message],id,user);
   if(!valid())return;
   setRows(cur=>mergeRows(cur,decoded));void loadThreads();
  }catch(e){
   if(!valid())return;
   if(wid)setRows(cur=>cur.map(r=>r.mine&&r.id===wid?{...r,status:"failed"}:r));
   setErr(dmError(code(e)));
  }
 };
 const block=async(b:boolean)=>{
  const c=convRef.current;if(!c)return;
  const pid=c.peer.userId,a=acct.current.value,ep=epoch.current.value;
  const ok=()=>acct.current.valid(a)&&epoch.current.valid(ep)&&convRef.current?.peer.userId===pid;
  try{
   const r=await request("dm:block",{v:1,userId:pid,blocked:b});
   if(!ok())return;
   setConv(cur=>cur&&cur.peer.userId===pid?{...cur,blocked:!!r.blocked}:cur);void loadThreads();
  }catch(e){if(ok())setErr(dmError(code(e)));}
 };
 const copy=()=>{if(!username)return;navigator.clipboard?.writeText(username).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1500);}).catch(()=>{});};

 if(identity===undefined)return <p className="chat-note" role="status">Loading…</p>;
 if(identity===null)return <div className="chat-panel"><h2>Set up secure chat first</h2><p>Direct messages use the same keys as TableTalk. Create them, or unlock with your six recovery words, in the TableTalk tab.</p><button className="primary" onClick={goSetup}>Go to TableTalk</button></div>;
 if(conv)return <>
  <div className="dm-bar"><button onClick={()=>{resetConv();setConv(null);setErr(null);void loadThreads();}} aria-label="Back to messages">Back</button><strong>{conv.peer.username}</strong><button onClick={()=>block(!conv.blocked)}>{conv.blocked?"Unblock":"Block"}</button></div>
  {conv.changed&&<div className="chat-warn" role="alert"><p><strong>{conv.peer.username}'s security key changed.</strong> Messages are hidden and sending is off until you trust the new key. Compare it with them in person or another app first.</p><p>Pinned <code>{conv.oldFp}</code></p><p>New <code>{conv.fp}</code></p><button onClick={trust}>Trust new key</button></div>}
  {conv.blocked&&<p className="chat-note" role="status">Blocked. You won't get messages from them and can't send.</p>}
  {err&&<p className="chat-note chat-error" role="alert">{err}</p>}
  <div className="chat-list" ref={list}>
   {cursor&&<button className="chat-more" onClick={()=>void refresh(true)}>Load earlier</button>}
   {rows.length===0&&!conv.changed&&<p className="chat-note">No messages yet.</p>}
   {rows.map(r=><div key={rowKey(r)} className="chat-msg" data-mine={r.mine} data-status={r.status}>
    <div className="chat-meta"><span>{r.mine?"You":conv.peer.username}</span><time dateTime={new Date(r.ts).toISOString()}>{time(r.ts)}</time></div>
    <p>{r.status==="ok"||r.status==="pending"||r.status==="failed"?r.text:r.status==="changed"?"Hidden: sent with a key that isn't trusted.":r.status==="unreadable"?"Can't be read on this device. It was sent to older keys.":"Hidden: failed verification."}</p>
    {r.status==="pending"&&<small>Sending…</small>}
    {r.status==="failed"&&<small className="chat-error">Not sent. <button type="button" onClick={()=>{if(r.mine)void send(r.id);}}>Retry</button></small>}
   </div>)}
  </div>
  <form className="chat-compose" onSubmit={e=>{e.preventDefault();void send();}}>
   <label className="sr-only" htmlFor="dm-input">Message {conv.peer.username}</label>
   <textarea id="dm-input" rows={1} value={text} disabled={conv.changed||conv.blocked} placeholder="Message" onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/>
   <button className="primary" disabled={conv.changed||conv.blocked||!text.trim()||new TextEncoder().encode(text).length>MAX_TEXT_BYTES}>Send</button>
  </form>
 </>;
 return <div className="dm-home">
  <div className="chat-panel">
   <p>Your username{username?<>: <strong>{username}</strong> <button onClick={copy}>{copied?"Copied":"Copy"}</button></>:" is loading…"}</p>
   <form className="dm-find" onSubmit={e=>{e.preventDefault();void open(find);}}>
    <label className="sr-only" htmlFor="dm-find">Exact username</label>
    <input id="dm-find" value={find} onChange={e=>setFind(e.target.value)} placeholder="Exact username" autoComplete="off" autoCapitalize="none" spellCheck={false}/>
    <button className="primary" disabled={busy||!find.trim()}>Message</button>
   </form>
   {err&&<p className="chat-error" role="alert">{err}</p>}
  </div>
  <ul className="dm-threads">
   {threads.length===0&&<li className="chat-note">No conversations yet.</li>}
   {threads.map(t=><li key={t.userId}><button onClick={()=>void open(t.username)}><span>{t.username}</span>{t.blocked&&<small> Blocked</small>}<time dateTime={new Date(t.updatedAt).toISOString()}>{time(t.updatedAt)}</time></button></li>)}
  </ul>
 </div>;
}
