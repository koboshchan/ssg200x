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
import {createPacer} from "@/lib/chat-pacer";
import {useActiveGameChat} from "./game-chat-context";

const errorText:Record<string,string>={admin_reset:"An admin reset your chat words. Create and save new words. Old words no longer unlock this account. Unsent messages were discarded and will not be retried. Older history needs a new key grant; a trusted member can share the current room key.",setup_words_lost:"Setup was interrupted. Enter the six words you saved.",wrong_words:"Those words don't match. Check the order and spelling.",bad_words:"Enter exactly six words from the list.",disconnected:"Not connected. Try again in a moment.",timeout:"The server didn't answer in time.",rate_limited:"Slow down a little.",busy:"The server is busy. Trying again.",identity_exists:"Chat keys already exist for this account. Retry loading chat to check recovery availability.",identity_inconsistent:"Existing chat key records could not be matched to a current recovery backup. Keep your recovery words and any browser that can still read chat. Ask an admin to check the key records without resetting them.",identity_unavailable:"Chat could not load a current recovery backup. Retry loading chat. Keep your recovery words and any browser that can still read chat.",identity_conflict:"Your keys changed on another device. Reload to continue.",forbidden:"Chat is only open to approved members.",room_closed:"This room's chat has closed or you are no longer in it.",context_required:"Chat for this room needs a fresh connection. Reconnecting.",unavailable:"Game chat is unavailable right now."};
const friendly=(code:string|null)=>code?errorText[code]||"Chat is unavailable right now.":null;
const group=(f:string)=>(f.match(/.{1,5}/g)||[]).join(" ");
const time=(ts:number)=>new Date(ts).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
const idle:Snapshot={phase:"loading",error:null,words:null,messages:[],members:[],hasMore:false,busy:false,historyIncomplete:false};

export default function ChatDock(){
 const {user,isLoaded}=useUser(),live=useLive(),userId=user?.id;
 const pathname=usePathname(),fixture=useQaFixture();
 const [qaRoom,setQaRoom]=useState<string|null>(null),[qaClient,setQaClient]=useState<ChatClient|null>(null);
 const game=useActiveGameChat();
 type Binding={user:string;main:ChatClient;make:(room:string)=>ChatClient;paced:<T,>(fn:()=>Promise<T>)=>Promise<T>};
 const [binding,setBinding]=useState<Binding|null>(null);
 const bound=binding&&binding.user===userId?binding:null;
 const mainClient=bound?.main??null;
 // Only Global plus the one active game client exist. Leaving a game closes its client; drafts live in the keyed pane.
 const [gameError,setGameError]=useState<{key:string;code:string}|null>(null),[retryTick,setRetryTick]=useState(0);
 const [gameBinding,setGameBinding]=useState<{user:string;room:string;client:ChatClient}|null>(null);
 const drafts=useRef(new Map<string,string>()),draftUser=useRef(userId);
 if(draftUser.current!==userId){draftUser.current=userId;drafts.current.clear();}
 const gameKey=game?game.kind+":"+game.id:null;
 const gameClient=bound&&gameKey&&gameBinding?.user===userId&&gameBinding?.room===gameKey?gameBinding.client:null;
 const gameRoom=gameKey;
 useEffect(()=>{
  if(!bound||!userId||!game||live.connection!=="connected"){setGameBinding(null);return;}
  let dead=false,c:ChatClient|null=null;
  const {kind,id}=game,key=kind+":"+id;
  setGameError(null);
  bound.paced(()=>dead?Promise.reject(new Error("cancelled")):live.request("game-chat:subscribe",{kind,id})).then(r=>{
   if(dead)return;
   if(typeof r?.chatRoom!=="string")throw new Error("unavailable");
   c=bound.make(r.chatRoom);chatRoomOf.current.set(key,r.chatRoom);setGameBinding({user:userId,room:key,client:c});
  }).catch((e:Error)=>{if(!dead&&e?.message!=="cancelled"){setGameBinding(null);setGameError({key,code:e?.message||"unavailable"});}});
  return()=>{dead=true;c?.close();setGameBinding(null);void bound.paced(()=>live.request("game-chat:leave",{kind,id})).catch(()=>{});};
 },[bound,userId,gameKey,live.connection,live.request,retryTick]);
 const chatRoomOf=useRef(new Map<string,string>());
 useLiveEvent("game-chat:closed",(p:{kind?:string;id?:string;chatRoom?:string})=>{const hit=game&&((p?.kind===game.kind&&p?.id===game.id)||(gameKey&&p?.chatRoom&&chatRoomOf.current.get(gameKey)===p.chatRoom));if(hit&&gameKey){setGameBinding(null);setGameError({key:gameKey,code:"room_closed"});}});
 const [open,setOpen]=useState(false),[names,setNames]=useState<Record<string,string>>({}),[seen,setSeen]=useState<number|null>(null);
 const [dmUnread,setDmUnread]=useState(0);
 const unreadScope=useRef(0);
 const loadDmUnread=useCallback(async()=>{if(!userId)return;const scope=++unreadScope.current;try{const r=await live.request("dm:unread",{v:1});if(scope===unreadScope.current)setDmUnread(Object.values(r.counts??{}).reduce<number>((n,v)=>n+(typeof v==="number"?v:0),0));}catch{}},[userId,live.request]);
 useEffect(()=>{unreadScope.current++;setDmUnread(0);if(userId&&live.connection==="connected")void loadDmUnread();},[userId,live.connection,loadDmUnread]);
 useLiveEvent("dm:changed",()=>{void loadDmUnread();});
 const {features:ft}=useFeatures();
 type Tab="room"|"game"|"dm"|"qa";
 const [pickedTab,setTab]=useState<Tab>("room");
 const gameFailed=gameError&&gameError.key===gameKey&&gameError.code;
 const hasGame=!!game&&ft.tableTalk;
 // Entering a game context selects Game; leaving it returns to Global.
 useEffect(()=>{setTab(hasGame?"game":"room");},[gameRoom,hasGame]);
 const tab:Tab=pickedTab==="qa"?(qaClient&&ft.tableTalk?"qa":"room"):pickedTab==="game"&&!hasGame?"room":pickedTab==="room"&&!ft.tableTalk&&ft.dms?"dm":pickedTab==="dm"&&!ft.dms&&ft.tableTalk?(hasGame?"game":"room"):pickedTab;
 const [preferencesUser,setPreferencesUser]=useState<string|null>(null);
 const preferencesReady=preferencesUser===userId;
 useEffect(()=>{
  if(!isLoaded||!userId)return;
  // Table changes select a retained room client, not a new identity/key lifecycle.
  // All three rooms share LiveProvider's one authenticated socket.
  const paced=createPacer();
  let requests:Promise<unknown>=Promise.resolve();
  // A previously viewed room can still be finishing sync. Queue budget claims
  // across retained clients instead of rejecting the next room as busy.
  const budget={...chatRequestBudget,request:(...args:Parameters<typeof chatRequestBudget.request>)=>{
   const next=requests.then(()=>chatRequestBudget.request(...args));
   requests=next.catch(()=>{});
   return next;
  }};
  // Account identity ops (register/keys:get/keys:put) always go to chatRoom "main", never a game room.
  // Game clients reuse the account's recent keys:get/register results instead of re-issuing them (no identity churn).
  const IDENTITY=["register","keys:get","keys:put"],identityCache=new Map<string,{at:number;p:Promise<any>}>();
  const send=(event:string,payload:unknown,room:string)=>{
   const isId=IDENTITY.includes(event),target=isId?"main":room;
   const call=()=>paced(()=>live.request("chat:"+event,{...(payload as object),chatRoom:target}));
   if(!isId)return call();
   if(event==="keys:put"){identityCache.clear();return call();}
   const key=event==="register"?"register:"+(payload as {deviceId?:string})?.deviceId:"keys:get",hit=identityCache.get(key);
   if(room!=="main"&&hit&&Date.now()-hit.at<(event==="register"?3600000:60000))return hit.p;
   const p=call();identityCache.set(key,{at:Date.now(),p});p.catch(()=>{if(identityCache.get(key)?.p===p)identityCache.delete(key);});
   return p;
  };
  const make=(room:string)=>new ChatClient(userId,(event,payload)=>send(event,payload,room),indexedDbStore(room),Date.now,undefined,budget,room);
  const main=make("main");
  setBinding({user:userId,main,make,paced});
  return()=>{main.close();};
 },[isLoaded,userId,live.request]);
 useEffect(()=>{
  // DEV isolated QA room: only when the server announces it in room:state.
  if(!userId||!qaRoom){setQaClient(null);return;}
  const c=new ChatClient(userId,(event,payload)=>live.request("chat:"+event,{...(payload as object),chatRoom:qaRoom}),indexedDbStore(qaRoom),Date.now,undefined,undefined,qaRoom,{isolatedQaChatRoom:true});
  setQaClient(c);
  return()=>{c.close();setQaClient(null);};
 },[userId,qaRoom,live.request]);
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
 useEffect(()=>{if(mainClient&&live.connection==="connected")void mainClient.reconnect();},[mainClient,live.connection]);
 useEffect(()=>{if(qaClient&&live.connection==="connected")void qaClient.reconnect();},[qaClient,live.connection]);
 useEffect(()=>{if(gameClient&&live.connection==="connected")void gameClient.reconnect();},[gameClient,live.connection]);
 useLiveEvent("chat:changed",(p:{v?:number;room?:string}|undefined)=>{const room=p?.v===1&&typeof p.room==="string"?p.room:null;// Room-scoped only. A legacy empty hint is main-only; never fan out (prevents the proven rate storm).
  if(!room||room==="main")mainClient?.hint();else if(gameKey&&chatRoomOf.current.get(gameKey)===room)gameClient?.hint();if(room&&room===qaRoom)qaClient?.hint();});
 useLiveEvent("room:state",(room:{pokerTableId?:string;qaChatRoom?:string;chatNames?:{publicId:string;name:string}[];leaderboard?:{publicId:string;name:string}[]})=>{setQaRoom(typeof room?.qaChatRoom==="string"&&room.qaChatRoom==="qa-isolated"?room.qaChatRoom:null);const rows=room?.chatNames??room?.leaderboard;if(rows)setNames(Object.fromEntries(rows.map(r=>[r.publicId,r.name])));});
 const snap=useSyncExternalStore(mainClient?mainClient.subscribe:()=>()=>{},mainClient?mainClient.getSnapshot:()=>idle,()=>idle);
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
   <div className="chat-tabs" role="tablist">{ft.tableTalk?<button role="tab" aria-selected={tab==="room"} onClick={()=>setTab("room")}>Global</button>:null}{hasGame?<button role="tab" aria-selected={tab==="game"} onClick={()=>setTab("game")}>{game!.label}</button>:null}{ft.dms?<button role="tab" aria-selected={tab==="dm"} onClick={()=>setTab("dm")}>Messages{dmUnread>0&&<span className="dm-unread" aria-label={`${dmUnread} unread messages`}>{dmUnread}</span>}</button>:null}{qaClient&&ft.tableTalk?<button role="tab" aria-selected={tab==="qa"} onClick={()=>setTab("qa")}>Room (DEV QA)</button>:null}</div>
   {tab==="room"?<Body snap={snap} client={mainClient} names={names} drafts={drafts.current} draftKey="main"/>:tab==="game"?<GamePane key={gameRoom} error={gameFailed} retry={()=>setRetryTick(n=>n+1)} client={gameClient} names={names} drafts={drafts.current} draftKey={gameRoom??""}/>:tab==="qa"?<GamePane key="qa" error={null} retry={()=>{}} client={qaClient} names={names} drafts={drafts.current} draftKey="qa"/>:<DmPanel phase={snap.phase} goSetup={()=>setTab("room")}/>}
  </aside>}
 </>;
}
type DraftProps={drafts:Map<string,string>;draftKey:string};
function GamePane({client,names,drafts,draftKey,error,retry}:{client:ChatClient|null;names:Record<string,string>;error:string|null;retry:()=>void}&DraftProps){
 const snap=useSyncExternalStore(client?client.subscribe:()=>()=>{},client?client.getSnapshot:()=>idle,()=>idle);
 if(!client&&!error)return <div className="chat-panel"><p className="chat-note" role="status">Connecting to this room's chat…</p></div>;
 if(!client&&error)return <div className="chat-panel"><p className="chat-note" role="alert">{friendly(error)}</p><button onClick={retry}>Try again</button></div>;
 return <Body snap={snap} client={client} names={names} drafts={drafts} draftKey={draftKey}/>;
}
function Body({snap,client,names,drafts,draftKey}:{snap:Snapshot;client:ChatClient|null;names:Record<string,string>}&DraftProps){
 const err=friendly(snap.error);
 if(!client||snap.phase==="loading")return <p className="chat-note" role="status">Connecting…</p>;
 if(snap.phase==="setup")return <div className="chat-panel"><h2>Set up secure chat</h2><p>Messages are encrypted on your device. You'll get six recovery words, shown once. They're the only way to read chat history on a new browser.</p>{err&&<p className="chat-error" role="alert">{err}</p>}<button className="primary" disabled={snap.busy} onClick={()=>client.createIdentity()}>{snap.busy?"Creating keys…":"Create my keys"}</button></div>;
 if(snap.phase==="words")return <Words words={snap.words||[]} busy={snap.busy} err={err} onDone={()=>client.confirmWords()}/>;
 if(snap.phase==="recover")return <Recover snap={snap} client={client} err={err}/>;
 if(snap.phase==="error")return <div className="chat-panel"><p className="chat-note" role="alert">{err}</p><button disabled={snap.busy} onClick={()=>client.retrySync()}>Retry loading chat</button></div>;
 return <Room snap={snap} client={client} names={names} drafts={drafts} draftKey={draftKey}/>;
}
function Words({words,onDone,busy,err}:{words:string[];onDone:()=>void;busy:boolean;err:string|null}){
 const [ok,setOk]=useState(false);
 return <div className="chat-panel"><h2>Write these down</h2><p>This is the only time they're shown. Anyone with them can read your chat history, so keep them private.</p><ol className="chat-words">{words.map((w,i)=><li key={i}>{w}</li>)}</ol><label className="chat-check"><input type="checkbox" checked={ok} onChange={e=>setOk(e.target.checked)}/>I saved my six words</label>{err&&<p className="chat-error" role="alert">{err}</p>}<button className="primary" disabled={!ok||busy} onClick={onDone}>{busy?"Saving…":"Continue"}</button></div>;
}
function Recover({snap,client,err}:{snap:Snapshot;client:ChatClient;err:string|null}){
 const [words,setWords]=useState("");
 return <form className="chat-panel" onSubmit={e=>{e.preventDefault();void client.recover(words);}}><h2>Unlock on this browser</h2><p>Enter your six recovery words to read chat here.</p><WordEntry value={words} onChange={setWords} count={6} disabled={snap.busy} label="Six recovery words"/>{err&&<p className="chat-error" role="alert">{err}</p>}<button className="primary" disabled={snap.busy||!words.trim()}>{snap.busy?"Unlocking…":"Unlock"}</button></form>;
}
function Room({snap,client,names,drafts,draftKey}:{snap:Snapshot;client:ChatClient;names:Record<string,string>}&DraftProps){
 const [text,setTextRaw]=useState(()=>drafts.get(draftKey)??""),setText=(v:string|((c:string)=>string))=>setTextRaw(c=>{const n=typeof v==="function"?v(c):v;if(n)drafts.set(draftKey,n);else drafts.delete(draftKey);return n;}),list=useRef<HTMLDivElement>(null),stick=useRef(true);
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
