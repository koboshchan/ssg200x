"use client";
import {getTabHeaders} from "@/lib/tab-identity";
// Single place for the browser JSON contract with the app API routes (snake_case, cents).
export type Scope="profile"|"balance:read"|"balance:debit"|"balance:credit";
export type Limits={per_operation_cents:number;daily_cents:number;lifetime_cents:number};
export const SCOPE_INFO:Record<Scope,{label:string;hint:string}>={
 "profile":{label:"Show your name",hint:"The app sees your public display name and a random ID only for this app."},
 "balance:read":{label:"See your balance",hint:"The app can read your ssg200x play-money balance."},
 "balance:debit":{label:"Spend your play money",hint:"The app can charge your play-money wallet, up to the limits below."},
 "balance:credit":{label:"Credit your play money",hint:"The app can return play money as refunds or, if approved, create play-money rewards."}};
export const SCOPE_ORDER:Scope[]=["profile","balance:read","balance:debit","balance:credit"];
export const LIMIT_FIELDS:{key:keyof Limits;label:string}[]=[{key:"per_operation_cents",label:"Per operation"},{key:"daily_cents",label:"Per day"},{key:"lifetime_cents",label:"Total, ever"}];
export const money=(cents:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:cents%100===0?0:2}).format(cents/100);
export const when=(v?:string|null)=>v?new Date(v).toLocaleString("en-CA",{dateStyle:"medium",timeStyle:"short"}):"never";
export async function api<T>(url:string,init?:{method?:string;body?:unknown}):Promise<T>{
 const write=init?.method&&init.method!=="GET";
 const r=await fetch(url,{method:init?.method??"GET",cache:"no-store",headers:write?{"content-type":"application/json",...getTabHeaders()}:undefined,body:init?.body===undefined?undefined:JSON.stringify(init.body)});
 const j=await r.json().catch(()=>({}));
 if(!r.ok){const e=new Error(typeof j.error==="string"?j.error:(j.error?.message??"Something went wrong."))as Error&{status:number};e.status=r.status;throw e;}
 return j as T;
}
export const errMsg=(e:unknown,fallback="Something went wrong.")=>e instanceof Error?e.message:fallback;
/** Dollars text <-> cents, whole cents only. Returns null when invalid. */
export function toCents(text:string):number|null{
 if(!/^\d{1,9}(\.\d{1,2})?$/.test(text.trim()))return null;
 const [whole,fraction=""]=text.trim().split(".");
 return Number(whole)*100+Number(fraction.padEnd(2,"0"));
}
export const toDollars=(c:number)=>(c/100).toFixed(c%100===0?0:2);
export type Tx={transaction_id:string;direction:"debit"|"credit";credit_reason?:string;amount_cents:number;description:string;created_at:string};
export type Grant={grant_id:string;app_id:string;app_name:string;external_subject:string;scopes:Scope[];limits:Limits;created_at:string;expires_at:string;revoked_at:string|null;todays_debit_cents:number;transactions:Tx[]};
export type AppView={app_id:string;client_id:string;name:string;description:string;website:string;status:"draft"|"pending"|"approved"|"suspended"|"deleted";approved_scopes:Scope[];credit_mode:"refunds"|"mint";limits:Limits;mint_limits:Limits;app_daily_cents:number;created_at:string;updated_at:string;owner_name?:string;credentials?:Cred[]};
export type Cred={credential_id:string;prefix:string;created_at:string;expires_at:string;revoked_at:string|null};
