"use client";
import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from "react";
import {fixtureChatInitiallyOpen} from "@/lib/qa-fixture-display";
import {useQaFixture} from "./qa-fixture-provider";
import {usePathname} from "next/navigation";
import {useUser} from "@clerk/nextjs";
import {useLive,useLiveEvent} from "./live-provider";
import {ChatClient,type ChatMessage,type Snapshot} from "@/lib/chat-client";
import {chatRequestBudget} from "@/lib/chat-request-budget";
import {indexedDbStore} from "@/lib/chat-store";
import WordEntry from "./word-entry";
import {MAX_TEXT_BYTES} from "@/lib/chat-crypto";
import DmPanel from "./dm-panel";
import {useFeatures} from "./use-features";

const errorText:Record<string,string>={admin_reset:"An admin reset your chat words. Create and save new words. Old words no longer unlock this account. Unsent messages were discarded and will not be retried. Older history needs a new key grant; a trusted member can share the current room key.",setup_words_lost:"Setup was interrupted. Enter the six words you saved.",wrong_words:"Those words don't match. Check the order and spelling.",bad_words:"Enter exactly six words from the list.",disconnected:"Not connected. Try again in a moment.",timeout:"The server didn't answer in time.",rate_limited:"Slow down a little.",busy:"The server is busy. Trying again.",identity_exists:"Chat keys already exist for this account. Enter your six recovery words.",identity_conflict:"Your keys changed on another device. Reload to continue.",forbidden:"Chat is only open to approved members."};
const friendly=(code:string|null)=>code?errorText[code]||"Chat is unavailable right now.":null;
const group=(f:string)=>(f.match(/.{1,5}/g)||[]).join(" ");
const time=(ts:number)=>new Date(ts).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
const idle:Snapshot={phase:"loading",error:null,words:null,messages:[],members:[],hasMore:false,busy:false,historyIncomplete:false};

export default function ChatDock(){
 const {user,isLoaded}=useUser(),live=useLive(),userId=user?.id;
 const pathname=usePathname(),fixture=useQaFixture();
 const [pokerTableId,setPokerTableId]=useState("01");
 const chatRoom=pathname==="/poker"&&pokerTableId!=="01"?"poker-"+pokerTableId:"main";
 const [binding,setBinding]=useState<{user:string;clients:Map<string,ChatClient>}|null>(null);
 const clients=binding&&binding.user===userId?binding.clients:null;
 const client=clients?.get(chatRoom)??null;
 const [open,setOpen]=useState(false),[names,setNames]=useState<Record<string,string>>({}),[seen,setSeen]=useState<number|null>(null);
 const [dmUnread,setDmUnread]=useState(0);
 const unreadScope=useRef(0);
 const loadDmUnread=useCallback(async()=>{if(!userId)return;const scope=++unreadScope.current;try{const r=await live.request("dm:unread",{v:1});if(scope===unreadScope.current)setDmUnread(Object.values(r.counts??{}).reduce<number>((n,v)=>n+(typeof v==="number"?v:0),0));}catch{}},[userId,live.request]);
 useEffect(()=>{unreadScope.current++;setDmUnread(0);if(userId&&live.connection==="connected")void loadDmUnread();},[userId,live.connection,loadDmUnread]);
 useLiveEvent("dm:changed",()=>{void loadDmUnread();});
 const {features:ft}=useFeatures();
 const [pickedTab,setTab]=useState<"room"|"dm">("room");
 const tab:"room"|"dm"=pickedTab==="room"&&!ft.tableTalk&&ft.dms?"dm":pickedTab==="dm"&&!ft.dms&&ft.tableTalk?"room":pickedTab;
 const [preferencesUser,setPreferencesUser]=useState<string|null>(null);
 const preferencesReady=preferencesUser===userId;
 useEffect(()=>{
  if(!isLoaded||!userId)return;
  // Table changes select a retained room client, not a new identity/key lifecycle.
  // All three rooms share LiveProvider's one authenticated socket.
  let requests:Promise<unknown>=Promise.resolve();
  // A previously viewed room can still be finishing sync. Queue budget claims
  // across retained clients instead of rejecting the next room as busy.
  const budget={...chatRequestBudget,request:(...args:Parameters<typeof chatRequestBudget.request>)=>{
   const next=requests.then(()=>chatRequestBudget.request(...args));
   requests=next.catch(()=>{});
   return next;
  }};
  const retained=new Map(["main","poker-02","poker-03"].map(room=>[room,new ChatClient(userId,(event,payload)=>live.request("chat:"+event,{...(payload as object),chatRoom:room}),indexedDbStore(room),Date.now,undefined,budget,room)]));
  setBinding({user:userId,clients:retained});
  return()=>{for(const c of retained.values())c.close();};
 },[isLoaded,userId,live.request]);
 useEffect(()=>{
  if(!userId)return;
  const key="tabletalk:"+userId;
  try{const saved=localStorage.getItem(key+":open");setOpen(fixtureChatInitiallyOpen(fixture,window.innerWidth,saved));const n=Number(localStorage.getItem(key+":seen"));setSeen(n>0?n:null);}catch{setOpen(window.innerWidth>=1280);setSeen(null);}
  setPreferencesUser(userId);
 },[userId,fixture]);
 useEffect(()=>{
  if(!preferencesReady||!userId)return;
  try{if(!fixture)localStorage.setItem("tabletalk:"+userId+":open",open?"1":"0");}catch{}
  document.documentElement.classList.toggle("chat-open",open);
  return()=>document.documentElement.classList.remove("chat-open");
 },[open,preferencesReady,userId,fixture]);
 useEffect(()=>{
  if(!open)return;
  const viewport=window.visualViewport;
  const resize=()=>{document.documentElement.style.setProperty("--chat-viewport-height",(viewport?.height??window.innerHeight)+"px");document.documentElement.style.setProperty("--chat-viewport-top",(viewport?.offsetTop??0)+"px");};
  resize();viewport?.addEventListener("resize",resize);viewport?.addEventListener("scroll",resize);
  return()=>{viewport?.removeEventListener("resize",resize);viewport?.removeEventListener("scroll",resize);document.documentElement.style.removeProperty("--chat-viewport-height");document.documentElement.style.removeProperty("--chat-viewport-top");};
 },[open]);
 useEffect(()=>{if(client&&live.connection==="connected")void client.reconnect();},[client,live.connection]);
 useLiveEvent("chat:changed",()=>client?.hint());
 useLiveEvent("room:state",(room:{pokerTableId?:string;chatNames?:{publicId:string;name:string}[];leaderboard?:{publicId:string;name:string}[]})=>{if(["01","02","03"].includes(room?.pokerTableId||""))setPokerTableId(room.pokerTableId!);const rows=room?.chatNames??room?.leaderboard;if(rows)setNames(Object.fromEntries(rows.map(r=>[r.publicId,r.name])));});
 const snap=useSyncExternalStore(client?client.subscribe:()=>()=>{},client?client.getSnapshot:()=>idle,()=>idle);
 const unread=snap.messages.filter(m=>!m.mine&&m.status==="ok"&&seen!==null&&m.serverTs>seen).length;
 useEffect(()=>{
  if(!userId||!preferencesReady||!["ready","waiting"].includes(snap.phase))return;
  // Establish a baseline for initial history, rather than counting it as incoming.
  if(open||seen===null){const next=Math.max(seen??0,...snap.messages.map(m=>m.serverTs),0);setSeen(next);try{localStorage.setItem("tabletalk:"+userId+":seen",String(next));}catch{}}
 },[open,snap.messages,snap.phase,seen,userId,preferencesReady]);
 if(!userId)return null;
 return <>
  {!open&&<button className="chat-toggle" onClick={()=>setOpen(true)} aria-label={unread?"Open chat, "+unread+" unread":"Open chat"}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/></svg>{unread>0&&<span className="chat-badge" aria-hidden="true">{unread>99?"99+":unread}</span>}</button>}
  {open&&<aside className="chat-dock" aria-label="TableTalk chat">
   <header><div><strong>TableTalk</strong><span className="chat-lock">End-to-end encrypted</span></div><button onClick={()=>setOpen(false)} aria-label="Hide chat">Hide</button></header>
   <div className="chat-tabs" role="tablist">{ft.tableTalk?<button role="tab" aria-selected={tab==="room"} onClick={()=>setTab("room")}>Room</button>:null}{ft.dms?<button role="tab" aria-selected={tab==="dm"} onClick={()=>setTab("dm")}>Messages{dmUnread>0&&<span className="dm-unread" aria-label={`${dmUnread} unread messages`}>{dmUnread}</span>}</button>:null}</div>
   {tab==="room"?<Body snap={snap} client={client} names={names}/>:<DmPanel phase={snap.phase} goSetup={()=>setTab("room")}/>}
  </aside>}
 </>;
}
function Body({snap,client,names}:{snap:Snapshot;client:ChatClient|null;names:Record<string,string>}){
 const err=friendly(snap.error);
 if(!client||snap.phase==="loading")return <p className="chat-note" role="status">Connecting…</p>;
 if(snap.phase==="setup")return <div className="chat-panel"><h2>Set up secure chat</h2><p>Messages are encrypted on your device. You'll get six recovery words, shown once. They're the only way to read chat history on a new browser.</p>{err&&<p className="chat-error" role="alert">{err}</p>}<button className="primary" disabled={snap.busy} onClick={()=>client.createIdentity()}>{snap.busy?"Creating keys…":"Create my keys"}</button></div>;
 if(snap.phase==="words")return <Words words={snap.words||[]} busy={snap.busy} err={err} onDone={()=>client.confirmWords()}/>;
 if(snap.phase==="recover")return <Recover snap={snap} client={client} err={err}/>;
 if(snap.phase==="error")return <p className="chat-note" role="alert">{err}</p>;
 return <Room snap={snap} client={client} names={names}/>;
}
function Words({words,onDone,busy,err}:{words:string[];onDone:()=>void;busy:boolean;err:string|null}){
 const [ok,setOk]=useState(false);
 return <div className="chat-panel"><h2>Write these down</h2><p>This is the only time they're shown. Anyone with them can read your chat history, so keep them private.</p><ol className="chat-words">{words.map((w,i)=><li key={i}>{w}</li>)}</ol><label className="chat-check"><input type="checkbox" checked={ok} onChange={e=>setOk(e.target.checked)}/>I saved my six words</label>{err&&<p className="chat-error" role="alert">{err}</p>}<button className="primary" disabled={!ok||busy} onClick={onDone}>{busy?"Saving…":"Continue"}</button></div>;
}
function Recover({snap,client,err}:{snap:Snapshot;client:ChatClient;err:string|null}){
 const [words,setWords]=useState("");
 return <form className="chat-panel" onSubmit={e=>{e.preventDefault();void client.recover(words);}}><h2>Unlock on this browser</h2><p>Enter your six recovery words to read chat here.</p><WordEntry value={words} onChange={setWords} count={6} disabled={snap.busy} label="Six recovery words"/>{err&&<p className="chat-error" role="alert">{err}</p>}<button className="primary" disabled={snap.busy||!words.trim()}>{snap.busy?"Unlocking…":"Unlock"}</button></form>;
}
function Room({snap,client,names}:{snap:Snapshot;client:ChatClient;names:Record<string,string>}){
 const [text,setText]=useState(""),list=useRef<HTMLDivElement>(null),stick=useRef(true);
 const bytes=new TextEncoder().encode(text).length,changed=snap.members.filter(m=>m.changed);
 const nameOf=(publicId:string,mine:boolean)=>names[publicId]||"Player";
 useEffect(()=>{const el=list.current;if(el&&stick.current)el.scrollTop=el.scrollHeight;},[snap.messages]);
 const submit=()=>{if(!text.trim()||bytes>MAX_TEXT_BYTES)return;const t=text;setText("");stick.current=true;void client.send(t).then(ok=>{if(!ok)setText(cur=>cur||t);});};
 return <>
  {snap.error==="sync_incomplete"&&<p className="chat-note" role="alert">Chat loading paused after repeated rate limits. <button onClick={()=>client.retrySync()}>Retry loading chat</button></p>}
  {snap.phase==="waiting"&&snap.error!=="sync_incomplete"&&<p className="chat-note" role="status">{snap.error==="sync_retry"?"Chat sync is busy. Retrying automatically.":snap.error==="history_incomplete"?"Still loading older messages. Retrying automatically.":snap.error==="rate_limited"?"Chat loading is rate limited. Retrying after a short delay.":"Waiting for a member to share the key. This opens when someone with access is online."}</p>}
  {changed.length>0&&<div className="chat-warn" role="alert">{changed.map(m=><p key={m.userId+":"+m.fingerprint}><strong>{m.historical?"Historical security key needs approval.":nameOf(m.publicId,false)+"'s security key changed."}</strong> {m.historical?"This key is attached to older messages. Compare its fingerprint with the sender before approving it.":"Messages from the new key stay hidden and they get no access until you trust it."} <code>{group(m.fingerprint)}</code><button onClick={()=>client.trust(m.userId,m.fingerprint)}>{m.historical?"Trust historical key":"Trust new key"}</button></p>)}</div>}
  <div className="chat-list" ref={list} onScroll={e=>{const el=e.currentTarget;stick.current=el.scrollHeight-el.scrollTop-el.clientHeight<40;}}>
   {snap.hasMore&&<button className="chat-more" disabled={snap.busy} onClick={()=>client.loadMore()}>{snap.busy?"Loading…":"Load earlier"}</button>}
   {snap.messages.length===0&&snap.phase==="ready"&&<p className="chat-note">No messages yet.</p>}
   {snap.messages.map(m=><Bubble key={m.key} m={m} who={nameOf(m.publicId,m.mine)} client={client}/>)}
  </div>
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
  {m.mine&&m.status==="failed"&&<small className="chat-error">Not sent. <button type="button" onClick={()=>client.retry(m)}>Retry</button> <button type="button" onClick={()=>client.dismiss(m)}>Remove</button></small>}
 </div>;
}
