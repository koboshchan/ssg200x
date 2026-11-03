import {SCOPE_ORDER,type Limits,type Scope} from "./app-api-client";
import {parseLimits,type LimitText} from "./limit-fields";
export type CreditMode="refunds"|"mint";
export type LinkPreview={confirmation_token:string;app:{app_id:string;name:string;description:string;website:string;status:string;credit_mode?:CreditMode};external_subject:string;requested_scopes:Scope[];limits:Limits;expires_at:string};
export const hasMoneyScope=(scopes:Scope[],mode?:CreditMode)=>scopes.includes("balance:debit")||(scopes.includes("balance:credit")&&mode==="mint");
export function creditHint(mode?:CreditMode){
 if(mode==="refunds")return "Refunds only, tied to this app's earlier charges within 90 days. It cannot create rewards or new play money.";
 if(mode==="mint")return "The app can refund earlier charges and create play-money rewards within your limits and its admin-approved caps.";
 return "Credit mode was not provided. No reward permission is implied; ask the app to issue a new code to confirm its policy.";
}
/** Build an independent request snapshot from the exact reviewed selection. */
export function consentBody(p:LinkPreview,scopes:Scope[],text:LimitText,ack:boolean){
 if(!scopes.length||new Set(scopes).size!==scopes.length||scopes.some(s=>!SCOPE_ORDER.includes(s)||!p.requested_scopes.includes(s)))throw new Error("Select at least one requested permission.");
 if(scopes.includes("balance:credit")&&!p.app.credit_mode)throw new Error("This app did not provide its credit policy. Request a new code before allowing credits.");
 if(scopes.includes("balance:debit")&&!ack)throw new Error("Confirm the play-money spending permission first.");
 const r=parseLimits(text,p.limits);if(!r.limits)throw new Error(r.error);
 return {confirmation_token:p.confirmation_token,scopes:[...scopes],limits:{...r.limits}};
}
