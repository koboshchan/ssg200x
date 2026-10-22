import {positionFeeRates} from "../runtime/perp-fee-policy.mjs";
import type {Position} from "./finance";
/** Explicit allowlist: no identity, email, credentials or arbitrary request content. */
export function financeAuditSnapshot(requestId:string,reason:"Open"|"Triggers"|"Manual"|"Liq",position:Position,mark:number|null){
 return {...(position.postedMargin!==undefined?{postedMargin:position.postedMargin}:{}),...(position.collateral!==undefined?{collateral:position.collateral}:{}),...positionFeeRates(position),...(position.closingFeeMode!==undefined?{closingFeeMode:position.closingFeeMode}:{}),openingFee:position.openingFee??0,...(position.revision!==undefined?{revision:position.revision}:{}),requestId,positionId:position.id,reason,entry:position.entry,mark,margin:position.margin,leverage:position.leverage,trigger:{takeProfit:position.takeProfit??null,stopLoss:position.stopLoss??null}};
}
