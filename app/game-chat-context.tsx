"use client";
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from "react";
/* Active game chat context. Pages declare what the player is actually looking at;
   ChatDock follows it automatically. No manual table chat switcher exists.
   Contexts are {kind,id} sent via game-chat:subscribe. The ACK's chatRoom (backend namespace game-poker-01, game-ddz-*, etc)
   is authoritative for chat:* routing; the client never builds chatRoom names itself. Legacy poker-02/03 stay Global-side only. */
export type GameChatContext={kind:string;id:string;label:string};
type Value={active:GameChatContext|null;register:(owner:symbol,ctx:GameChatContext|null)=>void};
const Ctx=createContext<Value|null>(null);
export function GameChatProvider({children}:{children:React.ReactNode}){
 const [stack,setStack]=useState<{owner:symbol;ctx:GameChatContext}[]>([]);
 const register=useCallback((owner:symbol,ctx:GameChatContext|null)=>{setStack(s=>{const rest=s.filter(x=>x.owner!==owner);return ctx?[...rest,{owner,ctx}]:rest;});},[]);
 const top=stack[stack.length-1]?.ctx??null;
 const active=useMemo(()=>top,[top?.kind,top?.id,top?.label]);
 const value=useMemo(()=>({active,register}),[active,register]);
 return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useActiveGameChat(){return useContext(Ctx)?.active??null;}
/** Declare the current game context; pass null when none (lobby, mini view, closed room). Unregisters on unmount. */
export function useGameChat(kind:string|null|undefined,id?:string|null,label?:string){
 const c=useContext(Ctx),owner=useRef<symbol>(undefined as unknown as symbol);
 owner.current??=Symbol("game-chat");
 const register=c?.register;
 useEffect(()=>{if(!register)return;register(owner.current,kind&&id?{kind,id,label:label||kind+" "+id}:null);return()=>register(owner.current,null);},[register,kind,id,label]);
}
