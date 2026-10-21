"use client";
import {useEffect,useRef,useState,type ReactNode} from "react";
import {createPortal} from "react-dom";
import type {PublicRoom} from "../lib/public";
import {PokerEmoteMenuActions,PokerThrowMenuActions} from "./poker-taunts";

export type PokerMenuTarget={seat:number;id:string;name:string};
export type PokerMenuModeration={pending?:boolean;disabledReason?:string};
type OpenMenu=PokerMenuTarget&{x:number;y:number;trigger:HTMLElement;tableId:string};
// One delegated click/tap menu. The extra-tables owner supplies only the moderation
// callback, while this component owns every menu item and the single popup.
export function PokerPlayerMenu({room,children,moderation}:{room:PublicRoom;children:ReactNode;moderation?:PokerMenuModeration}){
 const [menu,setMenu]=useState<OpenMenu|null>(null),menuRef=useRef<HTMLDivElement>(null);
 const close=()=>{setMenu(null);menu?.trigger.focus({preventScroll:true});};

 const target=(node:EventTarget|null)=>{const el=node instanceof Element?node.closest<HTMLElement>("[data-poker-seat]"):null;if(!el)return null;const i=Number(el.dataset.pokerSeat),seat=room.seats[i];return seat?{seat:i,id:seat.publicId,name:seat.name,trigger:el}:null;};
 const tableId=(room as PublicRoom&{pokerTableId?:string}).pokerTableId??"01";
 const valid=menu&&menu.tableId===tableId&&room.seats[menu.seat]?.publicId===menu.id;
 useEffect(()=>{
  if(!menu)return;
  const key=(e:KeyboardEvent)=>{if(e.key==="Escape"){e.preventDefault();setMenu(null);menu.trigger.focus({preventScroll:true});}};
  const dismiss=()=>setMenu(null);
  document.addEventListener("keydown",key);window.addEventListener("resize",dismiss);window.addEventListener("scroll",dismiss,true);
  return()=>{document.removeEventListener("keydown",key);window.removeEventListener("resize",dismiss);window.removeEventListener("scroll",dismiss,true);};
 },[menu]);
 useEffect(()=>{if(valid)menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({preventScroll:true});},[valid,menu]);
 return <div className="poker-player-menu-scope"
 onClick={e=>{const player=target(e.target);if(!player)return;const r=player.trigger.getBoundingClientRect();setMenu({...player,tableId,x:r.left+r.width/2,y:r.top+r.height/2});}}
 onKeyDown={e=>{if(e.key!=="Enter"&&e.key!==" ")return;const player=target(e.target);if(!player)return;e.preventDefault();const r=player.trigger.getBoundingClientRect();setMenu({...player,tableId,x:r.left+r.width/2,y:r.top+r.height/2});}}>
 {children}
 {valid&&menu?createPortal(<div className="poker-player-menu-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)close();}}><div ref={menuRef} role="menu" aria-label={"Actions for "+menu.name} className="poker-player-menu" style={{left:Math.max(8,Math.min(menu.x,window.innerWidth-248)),top:Math.max(8,Math.min(menu.y,window.innerHeight-300))}} onKeyDown={e=>{
 const buttons=Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]);
 if(["ArrowDown","ArrowUp","Home","End","Tab"].includes(e.key)){e.preventDefault();if(!buttons.length)return;const i=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[e.key==="Home"?0:e.key==="End"?buttons.length-1:(i+(e.key==="ArrowUp"||e.key==="Tab"&&e.shiftKey?-1:1)+buttons.length)%buttons.length]?.focus();}
 }}><div className="poker-player-menu-name">{menu.name}</div>{room.seats[menu.seat]?.isYou?<PokerEmoteMenuActions/>:<><PokerThrowMenuActions room={room} targetSeat={menu.seat} targetId={menu.id}/><button role="menuitem" type="button" disabled={moderation?.pending||!!moderation?.disabledReason} title={moderation?.disabledReason} onClick={()=>{
 if(room.me.admin&&!window.confirm("Kick "+menu.name+" from this poker table?"))return;
 window.dispatchEvent(new CustomEvent("poker-kick-request",{detail:{action:room.me.admin?"admin-kick":"start",targetPublicId:menu.id,tableId:menu.tableId,seat:menu.seat}}));
 setMenu(null);
 }}>{room.me.admin?"Kick":"Start vote kick"}</button>{moderation?.disabledReason?<small>{moderation.disabledReason}</small>:null}</>}<button type="button" role="menuitem" className="poker-menu-dismiss" onClick={close}>Close</button></div></div>,document.body):null}
 </div>;
}
