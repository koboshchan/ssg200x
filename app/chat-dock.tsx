"use client";
import {useEffect,useRef,useState,useSyncExternalStore} from "react";
import {useUser} from "@clerk/nextjs";
import {useLive,useLiveEvent} from "./live-provider";
import {ChatClient,type ChatMessage,type Snapshot} from "@/lib/chat-client";
import {indexedDbStore} from "@/lib/chat-store";
import {MAX_TEXT_BYTES} from "@/lib/chat-crypto";

const errorText:Record<string,string>={wrong_words:"Those words don't match. Check the order and spelling.",bad_words:"Enter exactly six words from the list.",disconnected:"Not connected. Try again in a moment.",timeout:"The server didn't answer in time.",rate_limited:"Slow down a little.",busy:"The server is busy. Trying again.",identity_conflict:"Your keys changed on another device. Reload to continue.",forbidden:"Chat is only open to approved members."};
const friendly=(code:string|null)=>code?errorText[code]||"Chat is unavailable right now.":null;
const group=(f:string)=>(f.slice(0,20).match(/.{1,5}/g)||[]).join(" ");
const time=(ts:number)=>new Date(ts).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
const idle:Snapshot={phase:"loading",error:null,words:null,messages:[],members:[],hasMore:false,busy:false};

export default function ChatDock(){
 const {user,isLoaded}=useUser(),live=useLive(),userId=user?.id;
 const [client,setClient]=useState<ChatClient|null>(null);
 const [open,setOpen]=useState(false),[names,setNames]=useState<Record<string,string>>({}),[seen,setSeen]=useState(0);
 useEffect(()=>{
  if(!isLoaded||!userId)return;
  const c=new ChatClient(userId,live.request,indexedDbStore());
  setClient(c);return()=>{c.close();setClient(null);};
 },[isLoaded,userId,live.request]);
 useEffect(()=>{setOpen(localStorage.getItem("tabletalk-open")==="1"||(localStorage.getItem("tabletalk-open")===null&&window.innerWidth>=1280));},[]);
 useEffect(()=>{localStorage.setItem("tabletalk-open",open?"1":"0");document.documentElement.classList.toggle("chat-open",open);return()=>document.documentElement.classList.remove("chat-open");},[open]);
 useEffect(()=>{if(client&&live.connection==="connected")void client.start();},[client,live.connection]);
 useLiveEvent("chat:changed",()=>client?.hint());
 useLiveEvent("room:state",(room:{leaderboard?:{publicId:string;name:string}[]})=>{if(room?.leaderboard)setNames(Object.fromEntries(room.leaderboard.map(r=>[r.publicId,r.name])));});
 const snap=useSyncExternalStore(client?client.subscribe:()=>()=>{},client?client.getSnapshot:()=>idle,()=>idle);
 const unread=snap.messages.filter(m=>!m.mine&&m.status==="ok"&&m.serverTs>seen).length;
 useEffect(()=>{if(open&&snap.messages.length)setSeen(Math.max(...snap.messages.map(m=>m.serverTs)));},[open,snap.messages]);
 if(!userId)return null;
 return <>
  {!open&&<button className="chat-toggle" onClick={()=>setOpen(true)} aria-label={unread?"Open chat, "+unread+" unread":"Open chat"}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/></svg>{unread>0&&<span className="chat-badge" aria-hidden="true">{unread>99?"99+":unread}</span>}</button>}
  {open&&<aside className="chat-dock" aria-label="TableTalk chat">
   <header><div><strong>TableTalk</strong><span className="chat-lock">End-to-end encrypted</span></div><button onClick={()=>setOpen(false)} aria-label="Hide chat">Hide</button></header>
   <Body snap={snap} client={client} names={names}/>
  </aside>}
 </>;
}
function Body({snap,client,names}:{snap:Snapshot;client:ChatClient|null;names:Record<string,string>}){
 const err=friendly(snap.error);
 if(!client||snap.phase==="loading")return <p className="chat-note" role="status">Connecting…</p>;
 if(snap.phase==="setup")return <div className="chat-panel"><h2>Set up secure chat</h2><p>Messages are encrypted on your device. You'll get six recovery words, shown once. They're the only way to read chat history on a new browser.</p>{err&&<p className="chat-error" role="alert">{err}</p>}<button className="primary" disabled={snap.busy} onClick={()=>client.createIdentity()}>{snap.busy?"Creating keys…":"Create my keys"}</button></div>;
 if(snap.phase==="words")return <Words words={snap.words||[]} onDone={()=>client.confirmWords()}/>;
 if(snap.phase==="recover")return <Recover snap={snap} client={client} err={err}/>;
 if(snap.phase==="error")return <p className="chat-note" role="alert">{err}</p>;
 return <Room snap={snap} client={client} names={names}/>;
}
function Words({words,onDone}:{words:string[];onDone:()=>void}){
 const [ok,setOk]=useState(false);
 return <div className="chat-panel"><h2>Write these down</h2><p>This is the only time they're shown. Anyone with them can read your chat history, so keep them private.</p><ol className="chat-words">{words.map((w,i)=><li key={i}>{w}</li>)}</ol><label className="chat-check"><input type="checkbox" checked={ok} onChange={e=>setOk(e.target.checked)}/>I saved my six words</label><button className="primary" disabled={!ok} onClick={onDone}>Continue</button></div>;
}
function Recover({snap,client,err}:{snap:Snapshot;client:ChatClient;err:string|null}){
 const [words,setWords]=useState("");
 return <form className="chat-panel" onSubmit={e=>{e.preventDefault();void client.recover(words);}}><h2>Unlock on this browser</h2><p>Enter your six recovery words to read chat here.</p><label className="sr-only" htmlFor="chat-words">Six recovery words</label><textarea id="chat-words" rows={2} autoComplete="off" autoCapitalize="none" spellCheck={false} value={words} onChange={e=>setWords(e.target.value)} placeholder="word word word word word word"/>{err&&<p className="chat-error" role="alert">{err}</p>}<button className="primary" disabled={snap.busy||!words.trim()}>{snap.busy?"Unlocking…":"Unlock"}</button></form>;
}
function Room({snap,client,names}:{snap:Snapshot;client:ChatClient;names:Record<string,string>}){
 const [text,setText]=useState(""),list=useRef<HTMLDivElement>(null),stick=useRef(true);
 const bytes=new TextEncoder().encode(text).length,changed=snap.members.filter(m=>m.changed);
 const nameOf=(publicId:string,mine:boolean)=>mine?"You":names[publicId]||"Member";
 useEffect(()=>{const el=list.current;if(el&&stick.current)el.scrollTop=el.scrollHeight;},[snap.messages]);
 const submit=()=>{if(!text.trim()||bytes>MAX_TEXT_BYTES)return;const t=text;setText("");stick.current=true;void client.send(t).then(ok=>{if(!ok)setText(cur=>cur||t);});};
 return <>
  {snap.phase==="waiting"&&<p className="chat-note" role="status">Waiting for a member to share the key. This opens when someone with access is online.</p>}
  {changed.length>0&&<div className="chat-warn" role="alert">{changed.map(m=><p key={m.userId}><strong>{nameOf(m.publicId,false)}'s security key changed.</strong> Messages from the new key stay hidden and they get no access until you trust it. <button onClick={()=>client.trust(m.userId)}>Trust new key</button></p>)}</div>}
  <div className="chat-list" ref={list} onScroll={e=>{const el=e.currentTarget;stick.current=el.scrollHeight-el.scrollTop-el.clientHeight<40;}}>
   {snap.hasMore&&<button className="chat-more" disabled={snap.busy} onClick={()=>client.loadMore()}>{snap.busy?"Loading…":"Load earlier"}</button>}
   {snap.messages.length===0&&snap.phase==="ready"&&<p className="chat-note">No messages yet.</p>}
   {snap.messages.map(m=><Bubble key={m.key} m={m} who={nameOf(m.publicId,m.mine)} client={client}/>)}
  </div>
  <details className="chat-safety"><summary>Security keys</summary>{snap.members.map(m=><p key={m.userId}><span>{nameOf(m.publicId,m.mine)}</span><code>{m.fingerprint?group(m.fingerprint):"no key yet"}</code></p>)}<small>Compare these with each person on another channel to be sure no one is impersonating them.</small></details>
  <form className="chat-compose" onSubmit={e=>{e.preventDefault();submit();}}>
   <label className="sr-only" htmlFor="chat-input">Message</label>
   <textarea id="chat-input" rows={1} value={text} disabled={snap.phase!=="ready"} placeholder={snap.phase==="ready"?"Message":"Locked until the key arrives"} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();submit();}}}/>
   <button className="primary" disabled={snap.phase!=="ready"||!text.trim()||bytes>MAX_TEXT_BYTES}>Send</button>
   {bytes>MAX_TEXT_BYTES-200&&<small className={bytes>MAX_TEXT_BYTES?"chat-error":""}>{bytes}/{MAX_TEXT_BYTES}</small>}
  </form>
 </>;
}
function Bubble({m,who,client}:{m:ChatMessage;who:string;client:ChatClient}){
 const body=m.status==="ok"||m.status==="pending"||m.status==="failed"?m.text:m.status==="keychanged"?"Hidden: sent with an untrusted key.":m.status==="unverified"?"Hidden: signature check failed.":"Can't be decrypted on this device.";
 return <div className="chat-msg" data-mine={m.mine} data-status={m.status}>
  <div className="chat-meta"><span>{who}</span><time dateTime={new Date(m.serverTs).toISOString()}>{time(m.serverTs)}</time></div>
  <p>{body}</p>
  {m.status==="pending"&&<small>Sending…</small>}
  {m.status==="failed"&&<small className="chat-error">Not sent. <button onClick={()=>client.retry(m)}>Retry</button> <button onClick={()=>client.dismiss(m)}>Discard</button></small>}
 </div>;
}
