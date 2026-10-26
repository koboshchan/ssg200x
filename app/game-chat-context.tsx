"use client";
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from "react";
/* Active game chat context. Pages declare what the player is actually looking at;
   ChatDock follows it automatically. No manual table chat switcher exists.
   chatRoom ids (backend owner validates): poker-01|02|03, blackjack-<tableId>, roulette,
   doudizhu-<roomCode>, pool-<poolRoomId>. "main" is Global and is never a game context. */
export type GameChatContext={chatRoom:string;label:string};
type Value={active:GameChatContext|null;register:(owner:symbol,ctx:GameChatContext|null)=>void};
const Ctx=createContext<Value|null>(null);
export function GameChatProvider({children}:{children:React.ReactNode}){
 const [stack,setStack]=useState<{owner:symbol;ctx:GameChatContext}[]>([]);
 const register=useCallback((owner:symbol,ctx:GameChatContext|null)=>{setStack(s=>{const rest=s.filter(x=>x.owner!==owner);return ctx?[...rest,{owner,ctx}]:rest;});},[]);
 const top=stack[stack.length-1]?.ctx??null;
 const active=useMemo(()=>top,[top?.chatRoom,top?.label]);
 const value=useMemo(()=>({active,register}),[active,register]);
 return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useActiveGameChat(){return useContext(Ctx)?.active??null;}
/** Declare the current game context; pass null when none (lobby, mini view, closed room). Unregisters on unmount. */
export function useGameChat(chatRoom:string|null|undefined,label?:string){
 const c=useContext(Ctx),owner=useRef<symbol>(undefined as unknown as symbol);
 owner.current??=Symbol("game-chat");
 const register=c?.register;
 useEffect(()=>{if(!register)return;register(owner.current,chatRoom?{chatRoom,label:label||chatRoom}:null);return()=>register(owner.current,null);},[register,chatRoom,label]);
}
