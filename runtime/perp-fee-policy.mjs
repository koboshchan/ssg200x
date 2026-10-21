// Approved initial setting. Explicit saved zero remains a valid admin override.
export const DEFAULT_PERP_FEE_PPM=300; // 0.03% of executed notional per side

/** Saved single-rate rooms inherit both legs, including an explicit zero. */
export function roomFeeRates(room){
 return {openingFeePpm:room.perpOpeningFeePpm??room.perpFeePpm??DEFAULT_PERP_FEE_PPM,closingFeePpm:room.perpClosingFeePpm??room.perpFeePpm??DEFAULT_PERP_FEE_PPM};
}
/** Pre-fee positions remain free; single-rate snapshots keep their agreed rate. */
export function positionFeeRates(position){
 return {openingFeePpm:position.openingFeePpm??position.feePpm??0,closingFeePpm:position.closingFeePpm??position.feePpm??0};
}

const MAX_PERP_FEE_PPM=1000;
export function feeCents(margin,leverage,entry,mark,ppm){
 if(![margin,leverage,entry,mark,ppm].every(Number.isSafeInteger)||margin<0||leverage<1||entry<=0||mark<=0||ppm<0||ppm>MAX_PERP_FEE_PPM)throw new Error("Invalid perpetual fee basis.");
 // Round once to nearest cent (half up), never round notional first.
 const numerator=BigInt(margin)*BigInt(leverage)*BigInt(mark)*BigInt(ppm),denominator=BigInt(entry)*1000000n;
 const result=Number((numerator+denominator/2n)/denominator);
 if(!Number.isSafeInteger(result))throw new Error("Perpetual fee exceeds safe limit.");
 return result;
}
