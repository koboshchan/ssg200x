import {io,type Socket} from "socket.io-client";
import {ChatClient,type Snapshot,type ChatMessage} from "../../lib/chat-client";
import {indexedDbStore} from "../../lib/chat-store";
import {chatRequestBudget} from "../../lib/chat-request-budget";

type Ctx={kind:string;id:string;label:string;room:string;group:string};
const user=new URLSearchParams(location.search).get("user")||"alice";
const CONTEXTS:Ctx[]=[
 ...["01","02","03"].map(id=>({kind:"poker",id,label:"Poker "+id,room:"game-poker-"+id,group:"Poker"})),
 ...["01","02","03"].map(id=>({kind:"blackjack",id,label:"Blackjack "+id,room:"game-blackjack-"+id,group:"Blackjack"})),
 {kind:"roulette",id:"01",label:"Roulette",room:"game-roulette-01",group:"Roulette"},
 ...["demo1","demo2"].map(id=>({kind:"ddz",id,label:"DDZ "+id,room:"game-ddz-"+id,group:"Doudizhu"})),
 ...["demo1","demo2"].map(id=>({kind:"pool",id,label:"Pool "+id,room:"game-pool-"+id,group:"Pool"})),
];
const socket:Socket=io({query:{user},transports:["websocket"]});
const request=(event:string,payload?:unknown)=>new Promise<any>((resolve,reject)=>{
 if(!socket.connected)return reject(new Error("disconnected"));
 socket.timeout(15000).emit(event,payload,(err:Error|null,res:any)=>{
  if(err||!res)reject(new Error("timeout"));
  else if(res.ok===false)reject(Object.assign(new Error(res.error||"unavailable"),{retryAfter:res.retryAfter,retryAfterUnit:res.retryAfterUnit,retryAfterMs:res.retryAfterMs}));
  else resolve(res);
 });
});
// One serialized queue shared by every retained client, as app/chat-dock does.
let queue:Promise<unknown>=Promise.resolve();
const budget={...chatRequestBudget,request:(...args:Parameters<typeof chatRequestBudget.request>)=>{
 const next=queue.then(()=>chatRequestBudget.request(...args));
 queue=next.catch(()=>{});
 return next;
}};
const clients=new Map<string,ChatClient>();
// Proactive pacing: >=700ms between transport request starts (<=~85/min, under the 120/min server limit).
// Requests are already serial through the shared queue above, so one monotonic clock is enough.
const MIN_GAP_MS=700;
let lastStart=-Infinity;
const pace=()=>{
 const wait=Math.max(0,lastStart+MIN_GAP_MS-performance.now());
 const go=()=>{lastStart=performance.now();};
 if(wait<=0){go();return Promise.resolve();}
 return new Promise<void>(res=>setTimeout(()=>{go();res();},wait));
};
const make=(room:string)=>new ChatClient(user,async(event,payload)=>{await pace();return request("chat:"+event,{...(payload as object),chatRoom:room});},indexedDbStore(room),Date.now,undefined,budget,room);
clients.set("main",make("main"));
// Only visited rooms are started, hinted or reconnected. Unopened rooms are forbidden server-side.
const visited=new Set<string>(["main"]);

let tab:"global"|"game"|"dm"="global";
let current:Ctx|null=null;
let connected=false;
const $=<T extends HTMLElement>(s:string)=>document.querySelector(s) as T;
const esc=(s:string)=>s.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]!));
const activeRoom=()=>tab==="global"?"main":tab==="game"&&current?current.room:null;
let unsub=()=>{};
const drafts=new Map<string,string>();

async function enter(kind:string,id:string,spectating=false){
 const prevRoom=current?.room;
 const r=await request("context:enter",spectating?{kind,id,role:"spectator"}:{kind,id});
 const base=CONTEXTS.find(c=>c.room===r.room)||{kind,id,label:r.label||kind+" "+id,room:r.room,group:kind};
 current={...base,label:spectating?base.label+" (watching)":base.label};
 for(const room of [...visited])if(room!=="main"&&room!==r.room){clients.get(room)?.close();clients.delete(room);visited.delete(room);}
 if(!(prevRoom===r.room&&clients.has(r.room))){clients.get(r.room)?.close();clients.set(r.room,make(r.room));}
 visited.add(r.room);
 tab="game";bind();void clients.get(r.room)?.reconnect();
 return r;
}
async function leave(){
 if(!current)return;
 const c=current;
 await request("context:leave",{kind:c.kind,id:c.id});
 drop(c.kind,c.id);
}
function drop(kind:string,id:string){
 const ctx=CONTEXTS.find(c=>c.kind===kind&&c.id===id);
 const room=ctx?.room||(current&&current.kind===kind&&current.id===id?current.room:null);
 if(room&&room!=="main"){
  visited.delete(room);
  const c=clients.get(room);if(c){c.close();clients.delete(room);}
 }
 if(current&&current.kind===kind&&current.id===id){current=null;tab="global";bind();}
 else render();
}
async function close(kind:string,id:string){
 const r=await request("game:close",{kind,id});
 drop(kind,id);
 return r;
}
function bind(){
 unsub();unsub=()=>{};
 const room=activeRoom(),c=room?clients.get(room):undefined;
 if(c)unsub=c.subscribe(render);
 render();
}
function setupFixture(c:ChatClient){
 return async()=>{await c.createIdentity();await c.confirmWords();};
}
function bubble(m:ChatMessage,c:ChatClient){
 const who=m.mine?"You":"Player "+m.publicId.slice(0,4);
 const t=new Date(m.ts).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
 const note=m.status==="failed"?'<button data-retry="'+esc(m.key)+'">Retry</button>':m.status==="pending"?"sending":m.status==="undecryptable"?"can't decrypt":m.status==="keychanged"||m.status==="unverified"?"unverified":"";
 const text=m.text===null?"Unable to read this message.":esc(m.text);
 return '<div class="msg'+(m.mine?" mine":"")+'" data-status="'+m.status+'"><div class="meta"><span>'+who+'</span><span>'+t+(note?" · "+note:"")+'</span></div><p>'+text+'</p></div>';
}
function tabs(){
 const t=(k:string,l:string)=>'<button role="tab" aria-selected="'+(tab===k)+'" data-tab="'+k+'">'+l+'</button>';
 return t("global","Global")+t("game","Game"+(current?" · "+esc(current.label):""))+t("dm","DM");
}
function picker(){
 const groups=[...new Set(CONTEXTS.map(c=>c.group))];
 return '<div class="picker">'+groups.map(g=>'<div class="grp"><span>'+g+'</span>'+CONTEXTS.filter(c=>c.group===g).map(c=>'<button data-enter="'+c.kind+'|'+c.id+'" aria-pressed="'+(current?.room===c.room)+'">'+esc(c.label.replace(g+" ","")||c.label)+'</button>'+(["ddz","pool"].includes(c.kind)?'<button class="ghost" data-enter="'+c.kind+'|'+c.id+'|spectator" title="Watch only">watch '+esc(c.id)+'</button>':"")).join("")+(["ddz","pool"].includes(CONTEXTS.find(c=>c.group===g)!.kind)?CONTEXTS.filter(c=>c.group===g).map(c=>'<button class="ghost" data-close="'+c.kind+'|'+c.id+'" title="Close room">close '+esc(c.id)+'</button>').join(""):"")+'</div>').join("")+'</div>';
}
function body(c:ChatClient,s:Snapshot,room:string){
 if(s.phase==="loading")return '<p class="note">Loading…</p>';
 if(s.phase==="setup")return '<div class="panel"><p>This fixture room has no keys yet.</p><button class="primary" id="init">Initialize fixture keys</button></div>';
 if(s.phase==="words")return '<div class="panel"><p>Keys created.</p><button class="primary" id="init2">Confirm</button></div>';
 if(s.phase==="recover")return '<p class="note" role="alert">This browser needs to be unlocked. Fixture recovery is not offered in this demo.</p>';
 if(s.phase==="error")return '<div class="panel"><p class="note" role="alert">Chat is unavailable ('+esc(s.error||"error")+').</p><button id="retry">Retry</button></div>';
 const wmsg:Record<string,string>={rate_limited:"Chat is rate limited. Retrying automatically.",sync_retry:"Chat sync is busy. Retrying automatically.",history_incomplete:"Still loading older messages. Retrying automatically.",sync_incomplete:"Loading paused after repeated rate limits."};
 const waiting=s.phase==="waiting"?'<p class="note" role="status">'+(s.error&&wmsg[s.error]?wmsg[s.error]+(s.error==="sync_incomplete"?' <button id="retry">Retry</button>':""):"Waiting for the encryption key. Someone in this room who has it needs to be online.")+'</p>':"";
 const warn=s.members.filter(m=>m.changed).map(m=>'<p class="warn" role="alert">Security key changed for Player '+m.publicId.slice(0,4)+' <button data-trust="'+m.userId+'|'+m.fingerprint+'">Trust</button></p>').join("");
 const ready=s.phase==="ready";
 return waiting+warn+'<div class="list" id="list">'+(s.hasMore?'<button class="more" id="more">Load earlier</button>':"")+(s.messages.length===0&&ready?'<p class="note">No messages yet.</p>':"")+s.messages.map(m=>bubble(m,c)).join("")+'</div>'+
 '<form class="compose" id="form"><label class="sr" for="in">Message</label><textarea id="in" rows="1" '+(ready?"":"disabled ")+'placeholder="'+(ready?"Message":"Locked until the key arrives")+'">'+esc(drafts.get(room)||"")+'</textarea><button class="primary" '+(ready?"":"disabled")+'>Send</button></form>';
}
function render(){
 const root=$("#app");
 const room=activeRoom(),c=room?clients.get(room):undefined;
 const prevList=document.getElementById("list"),stick=!prevList||prevList.scrollHeight-prevList.scrollTop-prevList.clientHeight<40;
 const had=document.activeElement?.id==="in";
 let main="";
 if(tab==="dm")main='<p class="note">Direct messages stay in the main app. Not part of this demo.</p>';
 else if(tab==="game"&&!c)main='<p class="note">No active game. Enter a table below, or stay in Global.</p>';
 else if(c&&room)main=body(c,c.getSnapshot(),room);
 root.innerHTML='<header><strong>TableTalk</strong><span class="sub">end-to-end encrypted · fixture demo</span><span class="who">'+esc(user)+'</span><span class="dot" data-on="'+connected+'" title="'+(connected?"connected":"offline")+'"></span></header>'+
 '<div class="tabs" role="tablist">'+tabs()+'</div>'+(tab==="game"||!current?"":"")+
 '<section class="chat">'+main+'</section><details class="ctx" '+(tab==="game"?"open":"")+'><summary>Tables</summary>'+(current?'<div class="picker"><button id="leave">Leave '+esc(current.label)+'</button></div>':"")+picker()+'</details>';
 const list=document.getElementById("list");if(list&&stick)list.scrollTop=list.scrollHeight;
 if(had)document.getElementById("in")?.focus();
 wire(c,room);
}
function wire(c?:ChatClient,room?:string|null){
 document.querySelectorAll<HTMLElement>("[data-tab]").forEach(b=>b.onclick=()=>{tab=b.dataset.tab as typeof tab;bind();});
 document.querySelectorAll<HTMLElement>("[data-enter]").forEach(b=>b.onclick=()=>{const [k,i,sp]=b.dataset.enter!.split("|");void enter(k,i,sp==="spectator").catch(()=>{});});
 const lv=document.getElementById("leave");if(lv)lv.onclick=()=>{void leave().catch(()=>{});};
 document.querySelectorAll<HTMLElement>("[data-close]").forEach(b=>b.onclick=()=>{const [k,i]=b.dataset.close!.split("|");void close(k,i).catch(()=>{});});
 if(!c||!room)return;
 const init=document.getElementById("init");if(init)init.onclick=()=>{void setupFixture(c)();};
 const init2=document.getElementById("init2");if(init2)init2.onclick=()=>{void c.confirmWords();};
 const retry=document.getElementById("retry");if(retry)retry.onclick=()=>{void c.retrySync();};
 const more=document.getElementById("more");if(more)more.onclick=()=>{void c.loadMore();};
 document.querySelectorAll<HTMLElement>("[data-trust]").forEach(b=>b.onclick=()=>{const [u,f]=b.dataset.trust!.split("|");void c.trust(u,f);});
 document.querySelectorAll<HTMLElement>("[data-retry]").forEach(b=>b.onclick=()=>{const m=c.getSnapshot().messages.find(x=>x.key===b.dataset.retry);if(m)void c.retry(m);});
 const form=document.getElementById("form") as HTMLFormElement|null,input=document.getElementById("in") as HTMLTextAreaElement|null;
 if(form&&input&&room){
  const origin=room;
  input.oninput=()=>{drafts.set(origin,input.value);};
  const send=()=>{const t=input.value;if(!t.trim())return;drafts.delete(origin);input.value="";void c.send(t).then(ok=>{
   if(ok)return;
   if(!drafts.get(origin))drafts.set(origin,t);
   if(activeRoom()===origin)render();
  });};
  form.onsubmit=e=>{e.preventDefault();send();};
  input.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing){e.preventDefault();send();}};
 }
}
// Scoped hints only: server sends {room}. No generic fanout; unknown or unvisited rooms are ignored.
socket.on("chat:changed",(p?:{room?:string;chatRoom?:string})=>{
 const room=p?.room??p?.chatRoom;
 if(!room||!visited.has(room))return;
 clients.get(room)?.hint();
});
socket.on("connect",()=>{connected=true;void clients.get("main")?.reconnect();
 // Membership follows the socket: re-establish the game context first. enter() reconnects the room client itself.
 if(current){const c=current;void enter(c.kind,c.id,c.label.includes("(watching)")).catch(e=>{if(current&&current.room===c.room&&["not_found","closed","room_closed","forbidden"].includes((e as Error).message))drop(c.kind,c.id);});}
 render();});
socket.on("disconnect",()=>{connected=false;render();});
socket.on("context:changed",(p:{kind:string;id:string;role?:string})=>{if(p&&p.kind&&p.id)void enter(p.kind,p.id,p.role==="spectator").catch(()=>{});});
socket.on("game:closed",(p:{kind:string;id:string})=>{if(p&&p.kind&&p.id)drop(p.kind,p.id);});
socket.on("room_closed",(p:{kind:string;id:string})=>{if(p&&p.kind&&p.id)drop(p.kind,p.id);});
(window as any).qa={clients,visited,socket,enter,close,leave,user,state:()=>({tab,current,room:activeRoom()})};
bind();
