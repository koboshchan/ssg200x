/** Eight independent fair left/right bounces, so slot k has C(8,k)/256 mass. */
export const PLINKO_RISKS = ["low", "medium", "high"] as const;
export type PlinkoRisk = typeof PLINKO_RISKS[number];
export const PLINKO_BINOMIAL = [1,8,28,56,70,56,28,8,1] as const;
export type PlinkoBucket = Readonly<{numerator:number;denominator:number;multiplier:number}>;
export function isPlinkoRisk(value:unknown):value is PlinkoRisk {
 return typeof value==="string" && (PLINKO_RISKS as readonly string[]).includes(value);
}
// Integer shape parameters, not quoted payouts. Wider wings exchange common
// central returns for rare edge rewards. Normalize independently for each risk.
const SHAPES:Record<PlinkoRisk,readonly number[]>={
 low:[8,6,5,4,3,4,5,6,8],
 medium:[16,8,4,2,1,2,4,8,16],
 high:[32,8,4,2,1,2,4,8,32],
};
function gcd(a:number,b:number):number{return b===0?a:gcd(b,a%b);}
function table(weights:readonly number[],bps=0):readonly PlinkoBucket[]{
 // This module is also imported by the browser; keep server crypto out.
 if(!Number.isSafeInteger(bps)||bps < -1000||bps > 1000)throw new RangeError("Invalid house edge basis points.");
 const ratio={num:10000-bps,den:10000};
 const sum=weights.reduce((n,w,k)=>n+w*PLINKO_BINOMIAL[k],0);
 return Object.freeze(weights.map(w=>{
  const n=w*ratio.num*256,d=ratio.den*sum,g=gcd(n,d);
  return Object.freeze({numerator:n/g,denominator:d/g,multiplier:n/d});
 }));
}
export const PLINKO_RISK_TABLES:Readonly<Record<PlinkoRisk,readonly PlinkoBucket[]>>=Object.freeze({
 low:table(SHAPES.low),medium:table(SHAPES.medium),high:table(SHAPES.high),
});
/** Fair normalized shape, scaled once by the room edge snapshotted at start. */
export function plinkoRiskTable(risk:PlinkoRisk,bps=0):readonly PlinkoBucket[]{return bps===0?PLINKO_RISK_TABLES[risk]:table(SHAPES[risk],bps);}
// Historical rounds retain the old shape and 98% floor-rounded semantics.
export const LEGACY_PLINKO_TABLE=table([32,8,4,2,1,2,4,8,32],200);
/** New tables have exact theoretical RTP (10000-bps)/10000. New settlements
 * stochastically round fractional cents, preserving that same expected RTP. */
