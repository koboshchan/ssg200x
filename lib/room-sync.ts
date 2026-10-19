import type {PublicRoom} from "./public";
export type MarketSnapshot=Pick<PublicRoom,"version"|"serverNow"|"quotes"|"holdings"|"positions"|"activity"|"leaderboard">&{wallet:number;netWorth:number};
export function mergeRoom(current:PublicRoom|null,next:PublicRoom){return current&&next.version<current.version?current:next;}
export function mergeMarket(current:PublicRoom|null,next:MarketSnapshot):PublicRoom|null{
 if(!current||next.version<current.version)return current;
 return {...current,version:next.version,serverNow:next.serverNow,quotes:next.quotes,holdings:next.holdings,positions:next.positions,activity:next.activity,leaderboard:next.leaderboard,me:{...current.me,wallet:next.wallet}};
}
/** A shared in-flight promise prevents simultaneous socket, fallback and mutation reads. */
export function coalescedRead<T>(read:()=>Promise<T>){let pending:Promise<T>|undefined;return ()=>pending??=(read().finally(()=>{pending=undefined;}));}
/** Entries announcing a newly settled position, keyed by the stable position id. */
export function settledNotices(activity:string[]){return activity.flatMap(entry=>{const m=/^(Liquidated|Take-profit|Stop-loss)\b.*\bposition (\S+)/.exec(entry);return m?[{id:m[2],text:entry}]:[];});}
/** Like coalescedRead, but a request arriving mid-flight triggers exactly one trailing read so no change is missed. */
export function trailingRead<T>(read:()=>Promise<T>){let pending:Promise<T>|undefined,dirty=false;const run=():Promise<T>=>{dirty=false;return read().then(async v=>{if(dirty)return run();return v;}).finally(()=>{if(!dirty)pending=undefined;});};return ()=>{if(pending){dirty=true;return pending;}pending=run();return pending;};}
