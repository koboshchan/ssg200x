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
function table(weights:readonly number[]):readonly PlinkoBucket[]{
 const sum=weights.reduce((n,w,k)=>n+w*PLINKO_BINOMIAL[k],0);
 return Object.freeze(weights.map(w=>{
  const n=w*98*256,d=100*sum,g=gcd(n,d);
  return Object.freeze({numerator:n/g,denominator:d/g,multiplier:n/d});
 }));
}
export const PLINKO_RISK_TABLES:Readonly<Record<PlinkoRisk,readonly PlinkoBucket[]>>=Object.freeze({
 low:table(SHAPES.low),medium:table(SHAPES.medium),high:table(SHAPES.high),
});
// Historical rounds used these weights, independently of any future defaults.
export const LEGACY_PLINKO_TABLE=table([32,8,4,2,1,2,4,8,32]);
/** Exact theoretical RTP is 98%. Settlement floors once in integer cents.
 * Each realized payout loses less than one cent to rounding; cent-floor RTP
 * is therefore slightly below (not exactly) 98% for most wager sizes. */
