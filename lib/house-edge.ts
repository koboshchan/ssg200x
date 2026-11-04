import {randomInt} from "node:crypto";
import {ensure} from "./errors";
import type {Room} from "./types";

/** Basis points of the wager's fair gross return. Negative values favor players. */
export const MIN_HOUSE_EDGE_BPS=-1000;
export const MAX_HOUSE_EDGE_BPS=1000;
export function validHouseEdgeBps(v:unknown):v is number {
 return typeof v==="number"&&Number.isSafeInteger(v)&&v>=MIN_HOUSE_EDGE_BPS&&v<=MAX_HOUSE_EDGE_BPS;
}
export function houseEdgeBps(room:Room):number {
 const saved=room.casinoLimits?.houseEdgeBps;
 return validHouseEdgeBps(saved)?saved:0;
}
export function edgeRatio(bps:number):{num:number;den:number} {
 ensure(validHouseEdgeBps(bps),"House edge must be between -10% and +10%, in 0.01% steps.");
 return {num:10000-bps,den:10000};
}
/** Rejection sampling avoids modulo/float bias for arbitrary rational denominators.
 * The injected RNG must be uniform in [0,max), just like crypto.randomInt.
 */
function below(limit:bigint,rng:(max:number)=>number):bigint {
 let bytes=1,range=256n;
 while(range<limit){bytes++;range*=256n;}
 const ceiling=range-range%limit;
 for(;;){
  let ticket=0n;
  for(let i=0;i<bytes;i++){
   const n=rng(256);ensure(Number.isInteger(n)&&n>=0&&n<256,"Invalid payout randomness.",500);
   ticket=ticket*256n+BigInt(n);
  }
  if(ticket<ceiling)return ticket%limit;
 }
}
/** Unbiased cent settlement: E[return] is the exact rational, not a floored quote.
 * Never use this for a preview or call twice for the same settlement.
 */
export function rationalPayout(bet:number,num:number|bigint,den:number|bigint,rng:(max:number)=>number=randomInt):number {
 ensure(Number.isSafeInteger(bet)&&bet>=0,"Invalid payout wager.",500);
 if(typeof num==="number")ensure(Number.isSafeInteger(num),"Invalid payout numerator.",500);
 if(typeof den==="number")ensure(Number.isSafeInteger(den),"Invalid payout denominator.",500);
 const n=BigInt(num),d=BigInt(den);
 ensure(n>=0n&&d>0n,"Invalid payout ratio.",500);
 const total=BigInt(bet)*n,base=total/d,rem=total%d;
 ensure(base+(rem?1n:0n)<=BigInt(Number.MAX_SAFE_INTEGER),"Payout limit reached.",409);
 return Number(base+(rem&&below(d,rng)<rem?1n:0n));
}
