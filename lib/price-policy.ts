/** Provider event age, never HTTP receipt age. Keep the WS strict 10s limit. */
export const STALE_MS=10_000;
export function quoteFresh(at:number,now:number,stock=false){
 return Number.isSafeInteger(at)&&at>=0&&at<=now&&(stock?now-at<60_000:now-at<=STALE_MS);
}
