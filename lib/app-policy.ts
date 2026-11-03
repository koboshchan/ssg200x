import {createHash,createHmac,randomBytes,randomInt,timingSafeEqual} from "node:crypto";
import {wordlist} from "@scure/bip39/wordlists/english.js";
import {z} from "zod";
export const SCOPES=["profile","balance:read","balance:debit","balance:credit"] as const;
export type Scope=typeof SCOPES[number];
export const scopeSchema=z.enum(SCOPES);
export const scopesSchema=z.array(scopeSchema).min(1).max(4).refine(s=>new Set(s).size===s.length,"Duplicate scope");
export const MAX_CENTS=100_000_000;
export const limitsSchema=z.object({per_operation_cents:z.number().int().min(0).max(MAX_CENTS),daily_cents:z.number().int().min(0).max(MAX_CENTS),lifetime_cents:z.number().int().min(0).max(MAX_CENTS)}).strict();
export type Limits=z.infer<typeof limitsSchema>;
export const DEFAULT_LIMITS:Limits={per_operation_cents:100_000,daily_cents:500_000,lifetime_cents:5_000_000};
export const ZERO_LIMITS:Limits={per_operation_cents:0,daily_cents:0,lifetime_cents:0};
export const LINK_TTL=600_000;
export const GRANT_TTL=90*86400_000;
export class AppApiError extends Error {constructor(public code:string,message:string,public status=400,public retryAfter?:number){super(message);}}
export function requireApp(ok:unknown,code:string,message:string,status=400):asserts ok {if(!ok)throw new AppApiError(code,message,status);}
export const digest=(domain:string,value:string)=>createHash("sha256").update("ssg.app.v1."+domain+"\0"+value).digest("hex");
export function keyedDigest(domain:string,value:string){
 const key=process.env.APP_LINK_HASH_KEY;
 requireApp(key&&key.length>=32,"temporarily_unavailable","App linking needs APP_LINK_HASH_KEY (32+ characters).",503);
 return createHmac("sha256",key).update("ssg.app.v1."+domain+"\0"+value).digest("hex");
}
export function secret(){return randomBytes(32).toString("base64url");}
export function equalHash(a:string,b:string){return a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
const words=new Set(wordlist);
export function normalizeAppCode(value:string){
 requireApp(value.length<=100,"invalid_request","Enter four words.");
 const code=value.trim().toLowerCase().replace(/\s+/g," "),parts=code.split(" ");
 requireApp(parts.length===4&&parts.every(w=>words.has(w)),"invalid_request","Enter four English BIP39 words.");return code;
}
export function generateAppCode(){return Array.from({length:4},()=>wordlist[randomInt(wordlist.length)]).join(" ");}
export function withinLimits(a:Limits,b:Limits){return Object.keys(a).every(k=>a[k as keyof Limits]<=b[k as keyof Limits]);}
export function minLimits(...values:Limits[]):Limits{return Object.fromEntries(Object.keys(DEFAULT_LIMITS).map(k=>[k,Math.min(...values.map(v=>v[k as keyof Limits]))])) as Limits;}
export const plain=z.string().trim().max(160).refine(v=>!/[\u0000-\u001f\u007f<>]/.test(v),"Use plain text");
export const registrationSchema=z.object({name:plain.min(2).max(64),description:plain.max(160),website:z.url().max(300).refine(v=>{const u=new URL(v);return u.protocol==="https:"&&!u.username&&!u.password},"Use an HTTPS website")}).strict();
export const moneySchema=z.object({amount_cents:z.number().int().positive().max(MAX_CENTS),description:plain,external_reference:plain.min(1),credit_reason:z.enum(["refund","mint"]).optional(),original_transaction_id:z.string().uuid().optional()}).strict();
export type MoneyInput=z.infer<typeof moneySchema>;
export function idempotencyDigest(key:string){requireApp(/^[A-Za-z0-9._:-]{8,128}$/.test(key),"invalid_request","Use an 8-128 character Idempotency-Key.");return digest("idempotency",key);}
