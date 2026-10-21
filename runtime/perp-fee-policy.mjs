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
