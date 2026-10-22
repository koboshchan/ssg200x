/** Shares are stored in integer micros. At 100% return the holding unchanged. */
export function sharesAtPercent(held:number,percent:number){
 if(!Number.isFinite(held)||held<=0)return 0;
 const p=Math.max(0,Math.min(100,percent));
 return p===100?held:Math.floor(Math.round(held*1e6)*p/100)/1e6;
}
export function percentOfShares(held:number,shares:number){
 return held>0&&Number.isFinite(shares)?Math.max(0,Math.min(100,shares/held*100)):0;
}
