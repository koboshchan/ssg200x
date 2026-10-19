import type {PublicRoom} from "./public";
export type MarketSnapshot=Pick<PublicRoom,"version"|"serverNow"|"quotes"|"holdings"|"positions"|"activity"|"leaderboard">&{wallet:number;netWorth:number};
export function mergeRoom(current:PublicRoom|null,next:PublicRoom){return current&&next.version<current.version?current:next;}
export function mergeMarket(current:PublicRoom|null,next:MarketSnapshot):PublicRoom|null{
 if(!current||next.version<current.version)return current;
 return {...current,version:next.version,serverNow:next.serverNow,quotes:next.quotes,holdings:next.holdings,positions:next.positions,activity:next.activity,leaderboard:next.leaderboard,me:{...current.me,wallet:next.wallet}};
}
/** A shared in-flight promise prevents simultaneous socket, fallback and mutation reads. */
export function coalescedRead<T>(read:()=>Promise<T>){let pending:Promise<T>|undefined;return ()=>pending??=(read().finally(()=>{pending=undefined;}));}
