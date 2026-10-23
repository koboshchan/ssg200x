import type {PublicRoom} from "./public";
export type MarketSnapshot=Pick<PublicRoom,"version"|"serverNow"|"quotes"|"holdings"|"positions"|"closedPositions"|"activity"|"leaderboard">&{perpFeePpm?:number;perpOpeningFeePpm?:number;perpClosingFeePpm?:number;perpClosingFeeMode?:PublicRoom["perpClosingFeeMode"];stockExecution?:PublicRoom["stockExecution"];cryptoStatus?:PublicRoom["cryptoStatus"];wallet:number;netWorth:number};
let quoteCache:PublicRoom["quotes"]={} as PublicRoom["quotes"];
export function mergeRoom(current:PublicRoom|null,next:PublicRoom){
 if(current&&(current as {pokerTableId?:string}).pokerTableId===(next as {pokerTableId?:string}).pokerTableId&&next.version<current.version)return current;
 quoteCache=Object.fromEntries(Object.entries({...quoteCache,...current?.quotes,...next.quotes}).sort((a,b)=>(b[1]?.at??0)-(a[1]?.at??0)).slice(0,64));
 return {...next,quotes:quoteCache};
}
export function mergeMarket(current:PublicRoom|null,next:MarketSnapshot):PublicRoom|null{
 if(!current||next.version<current.version)return current;
 return {...current,perpFeePpm:next.perpFeePpm??current.perpFeePpm,perpOpeningFeePpm:next.perpOpeningFeePpm??current.perpOpeningFeePpm,perpClosingFeePpm:next.perpClosingFeePpm??current.perpClosingFeePpm,perpClosingFeeMode:next.perpClosingFeeMode??current.perpClosingFeeMode,version:next.version,serverNow:next.serverNow,cryptoStatus:next.cryptoStatus===undefined?current.cryptoStatus:next.cryptoStatus,stockExecution:next.stockExecution??current.stockExecution,quotes:next.quotes,holdings:next.holdings,positions:next.positions,closedPositions:next.closedPositions,activity:next.activity,leaderboard:next.leaderboard,me:{...current.me,wallet:next.wallet}};
}
/** Entries announcing a newly settled position, keyed by the stable position id. */
export function settledNotices(activity:string[]){return activity.flatMap(entry=>{const m=/^(Liquidated|Take-profit|Stop-loss)\b.*\bposition (\S+)/.exec(entry);return m?[{id:m[2],text:entry}]:[];});}
/** Coalesces reads into at most two per flight: the first, plus one trailing read if anyone asked meanwhile. Calls during the trailing read share its result. A rejection clears all state so later calls start fresh. */
export function trailingRead<T>(read:()=>Promise<T>){let pending:Promise<T>|undefined,dirty=false;return ()=>{if(pending){dirty=true;return pending;}dirty=false;const p=read().then(v=>{if(!dirty)return v;dirty=false;return read();}).finally(()=>{if(pending===p){pending=undefined;dirty=false;}});pending=p;return p;};}
