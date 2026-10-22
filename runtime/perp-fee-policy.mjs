// Approved unsaved defaults. Explicit saved split or legacy single rates always win.
export const DEFAULT_PERP_FEE_PPM=300; // 0.03% opening on executed notional
export const DEFAULT_PERP_CLOSING_FEE_PPM=100; // 0.01% closing on executed notional

/** Saved single-rate rooms inherit both legs, including an explicit zero. */
export function roomFeeRates(room){
 return {openingFeePpm:room.perpOpeningFeePpm??room.perpFeePpm??DEFAULT_PERP_FEE_PPM,closingFeePpm:room.perpClosingFeePpm??room.perpFeePpm??DEFAULT_PERP_CLOSING_FEE_PPM};
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

/** Missing modes always retain the historical notional contract. */
export function closingFeeMode(snapshot){return snapshot.closingFeeMode??snapshot.perpClosingFeeMode??"notional";}
export function closingFeeReserve(position){return closingFeeMode(position)==="profit"?0:positionFeeRates(position).closingFeePpm/1e6;}
/** Profit is realized trading P/L minus the already paid opening fee, never collateral.
 * A loss, breakeven, or liquidation cannot owe a profit-share closing fee.
 */
export function closingFeeCents(position,mark,grossPnl,liquidated=false){
 const ppm=positionFeeRates(position).closingFeePpm;
 if(closingFeeMode(position)!=="profit"){
  if(position.closingFeeRoundUp){const n=BigInt(position.margin)*BigInt(position.leverage)*BigInt(mark)*BigInt(ppm),d=BigInt(position.entry)*1000000n;return Number((n+d-1n)/d);}
  return feeCents(position.margin,position.leverage,position.entry,mark,ppm);
 }
 if(!Number.isSafeInteger(ppm)||ppm<0||ppm>1000000||!Number.isSafeInteger(grossPnl))throw new Error("Invalid profit fee basis.");
 const profit=Math.max(0,grossPnl-(position.openingFee||0));
 if(liquidated||profit===0)return 0;
 return Number((BigInt(profit)*BigInt(ppm)+(position.closingFeeRoundUp?999999n:500000n))/1000000n);
}
