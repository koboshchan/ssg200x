/** Rates are integer millionths of notional. 500 ppm = 0.05% per side.
 * Existing positions without a snapshot are grandfathered at zero on both legs.
 */
export const MAX_PERP_FEE_PPM=1000; // 0.1% per side, at most 20% initial margin at 200x.
export function validFeePercent(n:number){return Number.isFinite(n)&&n>=0&&n<=MAX_PERP_FEE_PPM/10000&&Math.abs(n*10000-Math.round(n*10000))<1e-7;}
export function feeCents(margin:number,leverage:number,entry:number,mark:number,ppm:number){
 if(![margin,leverage,entry,mark,ppm].every(Number.isSafeInteger)||margin<0||leverage<1||entry<=0||mark<=0||ppm<0||ppm>MAX_PERP_FEE_PPM)throw new Error("Invalid perpetual fee basis.");
 // Round once to nearest cent (half up), never round notional first.
 const numerator=BigInt(margin)*BigInt(leverage)*BigInt(mark)*BigInt(ppm),denominator=BigInt(entry)*1000000n;
 const result=Number((numerator+denominator/2n)/denominator);
 if(!Number.isSafeInteger(result))throw new Error("Perpetual fee exceeds safe limit.");
 return result;
}
