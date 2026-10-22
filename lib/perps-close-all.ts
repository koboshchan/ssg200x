import type {Room,Identity} from "./types";
import {closePosition,legacyQuote} from "./finance";
import {AppError} from "./errors";
import {audit} from "./audit";
import {financeAuditSnapshot} from "./finance-audit";
export type CloseAllResult={requestId:string;closed:string[];alreadyClosed:string[];failed:{id:string;symbol:string;error:string}[]};
/** Called within the room CAS. IDs are the confirmation snapshot, never future positions.
 * Failed expected validations occur before settlement. Unexpected errors abort the CAS. */
export function closeAllPerps(room:Room,who:Identity,ids:string[],requestId:string,now=Date.now()):CloseAllResult{
 const result:CloseAllResult={requestId,closed:[],alreadyClosed:[],failed:[]};
 for(const id of new Set(ids)){
  const member=room.members.find(m=>m.id===who.id),position=member?.positions?.find(p=>p.id===id);
  if(!member||!position){
   if(member?.closedPositions?.some(p=>p.id===id))result.alreadyClosed.push(id);
   else result.failed.push({id,symbol:"Unknown",error:"Position not found in your account."});
   continue;
  }
  const old={...position},legacyValuation=legacyQuote(room,position.symbol,now);
  try{closePosition(room,who,id,now);}
  catch(error){
   if(!(error instanceof AppError))throw error;
   result.failed.push({id,symbol:position.symbol,error:error.message});continue;
  }
  const closed=member.closedPositions!.find(p=>p.id===id)!;
  audit(room,who,"finance-close",id,{...financeAuditSnapshot(requestId,"Manual",old,closed.exit),exists:true},{...financeAuditSnapshot(requestId,closed.reason==="Liq"?"Liq":"Manual",old,closed.exit),exists:false,...(legacyValuation?{legacyValuation}:{}),openingFee:closed.openingFee,closingFee:closed.closingFee,assessedClosingFee:closed.assessedClosingFee,waivedClosingFee:closed.waivedClosingFee,realizedPnl:closed.realizedPnl,closedAt:closed.closedAt});
  result.closed.push(id);
 }
 return result;
}
