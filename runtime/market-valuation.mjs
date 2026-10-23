/** Shared read-only mark valuation. Extracted unchanged from lib/finance.ts. */
import {closingFeeReserve,closingFeeCents} from "./perp-fee-policy.mjs";
export function pnl(p,mark){if(p.fx)return Math.floor(p.fx.units*(mark-p.entry)/1e6*(p.symbol.startsWith("USD/")?1e6/mark:p.fx.quoteUsd)*(p.side==="long"?1:-1));return Math.floor(p.margin*p.leverage*(mark-p.entry)/p.entry*(p.side==="long"?1:-1));}
export function liqPrice(p){if(p.liquidationOverride!=null)return p.liquidationOverride;const m=(p.maintenance||0)+closingFeeReserve(p);if(p.fx){const sign=p.side==="long"?1:-1,Q=p.fx.units,C=p.collateral??p.margin;if(p.symbol.startsWith("USD/")){const d=C+sign*Q-m*Q;return d===0?Infinity:Math.max(0,sign*Q*p.entry/d);}const k=Q*p.fx.quoteUsd/1e6;return Math.max(0,(sign*k*p.entry-C)/(k*(sign-m)));}return p.side==="long"?p.entry*(1-(p.collateral??p.margin)/(p.margin*p.leverage))/(1-m):p.entry*(1+(p.collateral??p.margin)/(p.margin*p.leverage))/(1+m);}
export function liquidatable(p,mark){return p.side==="long"?mark<=liqPrice(p):mark>=liqPrice(p);}
export function netPnl(p,mark){const gross=equity(p,mark),fee=closingFeeCents(p,mark,pnl(p,mark),liquidatable(p,mark));return (liquidatable(p,mark)?0:Math.max(0,gross-fee))-(p.postedMargin??p.margin)-(p.collateral===undefined?(p.openingFee||0):0);}
export function equity(p,mark){return Math.max(0,(p.collateral??p.margin)+pnl(p,mark));}
