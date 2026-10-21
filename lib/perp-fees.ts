export {DEFAULT_PERP_FEE_PPM} from "../runtime/perp-fee-policy.mjs";
/** Rates are integer millionths of notional. 500 ppm = 0.05% per side.
 * Existing positions without a snapshot are grandfathered at zero on both legs.
 */
export const MAX_PERP_FEE_PPM=1000; // 0.1% per side, at most 20% initial margin at 200x.
export function validFeePercent(n:number){return Number.isFinite(n)&&n>=0&&n<=MAX_PERP_FEE_PPM/10000&&Math.abs(n*10000-Math.round(n*10000))<1e-7;}
export {feeCents,openingFeeCents} from "../runtime/perp-fee-policy.mjs";
