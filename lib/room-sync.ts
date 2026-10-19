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
 * Contract with the shared websocket provider, which owns the one socket, Clerk auth and reconnects.
 * room is the latest full PublicRoom from "room:state"; status is the "maintenance:state" /api/maintenance shape;
 * history is the "history:state" object. Game merges room through mergeRoom so stale versions never rewind it.
 */
export type LiveValue={room:PublicRoom|null;status:unknown;history:unknown;connected:boolean};
export const LiveContext=createContext<LiveValue|null>(null);
/** Coalesces reads: calls during a flight share it and queue at most one trailing read. A rejection (even while dirty) clears all state so later calls start fresh. */
export function trailingRead<T>(read:()=>Promise<T>){let pending:Promise<T>|undefined,dirty=false;const run=():Promise<T>=>{dirty=false;return read().then(v=>dirty?run():v);};return ()=>{if(pending){dirty=true;return pending;}const p=run().finally(()=>{if(pending===p){pending=undefined;dirty=false;}});pending=p;return p;};}
