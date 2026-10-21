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

/**
 * Opening fee is included in the posted margin, not charged on top.
 * Solve N = M / (1 + leverage * rate), F = M - N on executed N * leverage.
 * Monetary policy: round the solved fee once, half up to whole cents, then
 * assign every remaining cent to collateral. This avoids iterative rounding
 * (which need not have a fixed point) and always conserves M = N + F.
 * The executed-notional fee differs from the unrounded rate by at most
 * half a cent * (1 + leverage * rate), due only to collateral cent rounding.
 */
export function openingFeeCents(postedMargin,leverage,ppm){
 if(![postedMargin,leverage,ppm].every(Number.isSafeInteger)||postedMargin<0||leverage<1||leverage>200||ppm<0||ppm>MAX_PERP_FEE_PPM)throw new Error("Invalid opening fee basis.");
 const k=BigInt(leverage)*BigInt(ppm),denominator=1000000n+k;
 return Number((BigInt(postedMargin)*k+denominator/2n)/denominator);
}
