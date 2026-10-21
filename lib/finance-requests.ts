import {createHash} from "node:crypto";
import {ensure} from "./errors";
import type {Room} from "./types";
export type FinanceInput={requestId:string;requestAt:number;[key:string]:unknown};
export type FinanceReceipt={id:string;userId:string;fingerprint:string;at:number;outcome:"committed"|"cancelled"|"expired"};
const RETAIN=24*60*60*1000;
function canonical(value:unknown):string {
 if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
 if(value&&typeof value==="object")return "{"+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+":"+canonical(v)).join(",")+"}";
 return JSON.stringify(value)??"null";
}
export function financeFingerprint(input:FinanceInput){return createHash("sha256").update(canonical(input)).digest("hex");}
export function financeReceipt(room:Room,userId:string,input:FinanceInput){
 const receipt=room.financeReceipts?.find(r=>r.id===input.requestId);
 if(receipt){ensure(receipt.userId===userId&&receipt.fingerprint===financeFingerprint(input),"Request key was used for a different order.",409);return receipt.outcome;}
 // Historical receipts did not retain payloads. They can acknowledge, never execute again.
 const legacy=room.receipts.find(r=>r.id===input.requestId);
 if(legacy){ensure(legacy.userId===userId,"Invalid request.",409);return "committed" as const;}
 return null;
}
export function checkFinanceRequest(room:Room,userId:string,input:FinanceInput,now=Date.now()){
 const outcome=financeReceipt(room,userId,input);
 ensure(outcome!=="cancelled"&&outcome!=="expired","This order was cancelled during connection recovery. Review before placing a new order.",409);
 if(outcome==="committed")return true;
 ensure(now-input.requestAt>=-10_000&&now-input.requestAt<=120_000,"Request expired. Review before placing a new order.",409);
 return false;
}
export function recordFinanceRequest(room:Room,userId:string,input:FinanceInput,outcome:FinanceReceipt["outcome"],now=Date.now()){
 room.financeReceipts=[{id:input.requestId,userId,fingerprint:financeFingerprint(input),at:now,outcome},...(room.financeReceipts??[]).filter(r=>r.id!==input.requestId&&now-r.at<RETAIN)];
}
/** Run inside the same room CAS as execution. An absent request is fenced, not
 * retried. Whichever CAS wins decides the outcome, including late HTTP handlers. */
export function reconcileFinanceRequest(room:Room,userId:string,input:FinanceInput,now=Date.now()){
 const outcome=financeReceipt(room,userId,input);if(outcome)return outcome;
 // Beyond retention, absence is no longer evidence that an order never executed.
 const result=now-input.requestAt>RETAIN?"expired":"cancelled";
 recordFinanceRequest(room,userId,input,result,now);return result;
}
