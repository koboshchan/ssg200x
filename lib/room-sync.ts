import {createContext} from "react";
import type {PublicRoom} from "./public";
export type MarketSnapshot=Pick<PublicRoom,"version"|"serverNow"|"quotes"|"holdings"|"positions"|"activity"|"leaderboard">&{wallet:number;netWorth:number};
export function mergeRoom(current:PublicRoom|null,next:PublicRoom){return current&&next.version<current.version?current:next;}
export function mergeMarket(current:PublicRoom|null,next:MarketSnapshot):PublicRoom|null{
 if(!current||next.version<current.version)return current;
 return {...current,version:next.version,serverNow:next.serverNow,quotes:next.quotes,holdings:next.holdings,positions:next.positions,activity:next.activity,leaderboard:next.leaderboard,me:{...current.me,wallet:next.wallet}};
}
/** Entries announcing a newly settled position, keyed by the stable position id. */
export function settledNotices(activity:string[]){return activity.flatMap(entry=>{const m=/^(Liquidated|Take-profit|Stop-loss)\b.*\bposition (\S+)/.exec(entry);return m?[{id:m[2],text:entry}]:[];});}
/**
 * Contract with the shared websocket provider. The provider owns the single socket, Clerk token auth and reconnects;
 * it supplies this bus through LiveContext. subscribe returns an unsubscribe function. Events used by the game are
 * "room:state" (PublicRoom) and "market:update" (MarketSnapshot).
 */
export type LiveBus={subscribe:(event:string,handler:(payload:any)=>void)=>()=>void};
export const LiveContext=createContext<LiveBus|null>(null);
