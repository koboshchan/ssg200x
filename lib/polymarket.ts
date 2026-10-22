import {z} from "zod";
import {createHash} from "node:crypto";
import {ensure} from "./errors";
import {register} from "./poker";
import {audit} from "./audit";
import {checkFinanceRequest,recordFinanceRequest} from "./finance-requests";
import {polyFixed,polyId,polyToken,QUOTE_TTL} from "./polymarket-data";
import type {Room,Identity} from "./types";
import type {PolyState,PolyTrade,PolyMarket,PolyBook,PolyPortfolio,PolyResolution,PolyHistory} from "./polymarket-types";
export const polyTradeSchema=z.object({action:z.enum(["buy","sell"]),marketId:polyId,tokenId:polyToken,amount:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),limitPrice:z.number().positive().lt(1),requestId:z.string().uuid(),requestAt:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)}).strict();
export const polySettingsSchema=z.object({enabled:z.boolean(),maxTrade:z.number().int().min(1).max(100_000_000)}).strict();
const DENOM=10_000_000_000n;
function safe(n:bigint){ensure(n>=0n&&n<=BigInt(Number.MAX_SAFE_INTEGER),"Prediction amount overflow.",409);return Number(n);}
function ceil(n:bigint,d:bigint){return(n+d-1n)/d;}
export function polyState(r:Room):PolyState{return r.polymarket??={enabled:true,maxTrade:100_000,positions:[],history:{},settlements:{}};}
export function polySettings(r:Room){return{enabled:r.polymarket?.enabled??true,maxTrade:r.polymarket?.maxTrade??100_000};}
export function polyPortfolio(r:Room,who:Identity):PolyPortfolio{
 const m=r.members.find(m=>m.id===who.id);ensure(!m?.accessRevoked,"Room access revoked.",403);
 const s=r.polymarket;
 return {...polySettings(r),wallet:m?.wallet??100_000,positions:(s?.positions??[]).filter(p=>p.userId===who.id).map(({userId,...p})=>p),history:s?.history[who.id]??[]};
}
export function changePolymarketSettings(r:Room,who:Identity,value:{enabled:boolean;maxTrade:number}){
 ensure(who.admin,"Administrator access required.",403);polySettingsSchema.parse(value);
 const s=polyState(r),old=polySettings(r);s.enabled=value.enabled;s.maxTrade=value.maxTrade;audit(r,who,"polymarket.settings","global",old,value);
}
function remember(s:PolyState,userId:string,value:PolyHistory){s.history[userId]=[value,...(s.history[userId]??[])].slice(0,200);}
function wallet(r:Room,m:Room["members"][number],delta:number){
 ensure(Number.isSafeInteger(delta)&&Number.isSafeInteger(m.wallet+delta)&&m.wallet+delta>=0&&m.wallet+delta<=1_000_000_000,"Insufficient balance or wallet limit reached.",409);
 const house=(r.house??0)-delta;ensure(Number.isSafeInteger(house),"Prediction ledger overflow.",409);
 m.wallet+=delta;r.house=house;
}
/** Shared local fill preview/execution math. Buy amount is cents; sell amount is microshares.
 * Aggregate once, debit ceil / credit floor, so a round trip cannot mint rounding cents. */
export function fillPolymarket(book:PolyBook,action:"buy"|"sell",amount:number,limitPrice:number){
 ensure(Number.isSafeInteger(amount)&&amount>0,"Invalid prediction amount.");
 const limit=polyFixed(limitPrice);ensure(limit>0&&limit<1e6,"Invalid limit price.");
 const levels=action==="buy"?book.asks:book.bids;let shares=0n,notional=0n,remaining=BigInt(amount)*(action==="buy"?DENOM:1n);
 for(const level of levels){
  const p=BigInt(level.priceMicros),available=BigInt(level.shareMicros);
  if(action==="buy"?p>BigInt(limit):p<BigInt(limit))break;
  const take=action==="buy"?(remaining/p<available?remaining/p:available):(remaining<available?remaining:available);
  if(take<=0n)break;shares+=take;notional+=take*p;remaining-=action==="buy"?take*p:take;
  if(!remaining)break;
 }
 const cents=action==="buy"?ceil(notional,DENOM):notional/DENOM;
 ensure(shares>0n&&cents>0n,"Order is too small at current prices.",409);
 ensure(action==="buy"?cents===BigInt(amount):remaining===0n,"Not enough liquidity within your price limit.",409);
 return {shareMicros:safe(shares),amount:safe(cents),averagePrice:Number(notional/shares)/1e6};
}
export function applyPolymarketTrade(r:Room,who:Identity,input:PolyTrade,market:PolyMarket,book:PolyBook,now=Date.now()){
 polyTradeSchema.parse(input);
 // Replays acknowledge the durable result even if the market/feed/admin state changed.
 if(checkFinanceRequest(r,who.id,input))return;
 const m=register(r,who),s=polyState(r);ensure(s.enabled,"Prediction trading is disabled.",409);
 ensure(market.id===input.marketId&&market.version!=="unsupported"&&market.acceptingOrders&&!market.closed,"Market is not accepting trades.",409);
 ensure(market.asOf<=now+1000&&now-market.asOf<=QUOTE_TTL,"Market status is stale. Refresh and try again.",409);
 ensure(book.tokenId===input.tokenId&&book.conditionId===market.conditionId&&market.outcomes.some(o=>o.tokenId===input.tokenId),"Outcome does not belong to this market.",409);
 ensure(book.asOf<=now+1000&&now-book.asOf<=QUOTE_TTL&&book.fetchedAt<=now+1000&&now-book.fetchedAt<=QUOTE_TTL,"Live quote is stale. Refresh and try again.",409);
 ensure(!s.settlements[market.id],"Market already settled.",409);
 const fill=fillPolymarket(book,input.action,input.amount,input.limitPrice);
 ensure(fill.amount<=s.maxTrade,"Trade exceeds the prediction trade limit.",409);
 const id=createHash("sha256").update(who.id+"\0"+market.id+"\0"+input.tokenId).digest("hex");
 let p=s.positions.find(p=>p.id===id),cost=fill.amount;
 if(input.action==="buy"){
  ensure(s.positions.length<5000||p,"Too many open prediction positions.",409);
  wallet(r,m,-fill.amount);
  if(p){ensure(p.conditionId===market.conditionId&&p.version===market.version,"Market identity changed.",409);p.shareMicros=safe(BigInt(p.shareMicros)+BigInt(fill.shareMicros));p.cost=safe(BigInt(p.cost)+BigInt(fill.amount));}
  else{s.positions.push({id,userId:who.id,marketId:market.id,conditionId:market.conditionId,version:market.version,tokenId:input.tokenId,question:market.question,outcome:market.outcomes.find(o=>o.tokenId===input.tokenId)!.label,image:market.image,slug:market.slug,shareMicros:fill.shareMicros,cost:fill.amount,openedAt:now});}
 }else{
  ensure(p&&p.userId===who.id&&p.shareMicros>=fill.shareMicros,"Not enough outcome shares.",409);
  ensure(p.conditionId===market.conditionId&&p.version===market.version,"Market identity changed.",409);
  cost=fill.shareMicros===p.shareMicros?p.cost:safe(BigInt(p.cost)*BigInt(fill.shareMicros)/BigInt(p.shareMicros));
  wallet(r,m,fill.amount);p.shareMicros-=fill.shareMicros;p.cost-=cost;
  if(!p.shareMicros)s.positions=s.positions.filter(x=>x.id!==id);
 }
 const item:PolyHistory={id:input.requestId,requestId:input.requestId,marketId:market.id,tokenId:input.tokenId,question:market.question,outcome:market.outcomes.find(o=>o.tokenId===input.tokenId)!.label,action:input.action,shareMicros:fill.shareMicros,amount:fill.amount,cost,at:now};
 remember(s,who.id,item);recordFinanceRequest(r,who.id,input,"committed",now);
 audit(r,who,"polymarket."+input.action,id,{requestId:input.requestId,wallet:m.wallet+(input.action==="buy"?fill.amount:-fill.amount)},{...item,wallet:m.wallet,bookAt:book.asOf,bookHash:book.hash,averagePrice:fill.averagePrice});
}
const worker:Identity={id:"system:polymarket",name:"Prediction settlement",email:"",admin:true};
export function settlePolymarket(r:Room,resolution:PolyResolution,now=Date.now()){
 const s=r.polymarket;if(!s||s.settlements[resolution.marketId])return false;
 ensure(resolution.asOf<=now+1000&&now-resolution.asOf<=60_000,"Resolution evidence expired.",409);
 const payouts=Object.values(resolution.payouts);
 ensure(["gamma+clob-final","data-v2-final"].includes(resolution.source)&&payouts.length===2&&payouts.every(p=>Number.isSafeInteger(p)&&p>=0&&p<=1e6)&&payouts.reduce((a,b)=>a+b,0)===1e6,"Invalid resolution evidence.",409);
 const positions=s.positions.filter(p=>p.marketId===resolution.marketId);if(!positions.length)return false;
 for(const p of positions){
  ensure(p.conditionId===resolution.conditionId&&p.version===resolution.version&&Object.hasOwn(resolution.payouts,p.tokenId),"Resolution identity mismatch.",409);
  const m=r.members.find(m=>m.id===p.userId);ensure(m,"Prediction owner missing.",500);
  const amount=resolution.kind==="void"?safe(BigInt(p.cost)):safe(BigInt(p.shareMicros)*BigInt(resolution.payouts[p.tokenId])/DENOM);wallet(r,m,amount);
  const item:PolyHistory={id:"settle:"+p.id,requestId:"settle:"+resolution.marketId,marketId:p.marketId,tokenId:p.tokenId,question:p.question,outcome:p.outcome,action:resolution.kind,shareMicros:p.shareMicros,amount,cost:p.cost,at:now};
  remember(s,p.userId,item);audit(r,worker,"polymarket."+resolution.kind,p.id,{shareMicros:p.shareMicros,cost:p.cost},{...item,payoutMicros:resolution.payouts[p.tokenId],source:resolution.source});
 }
 s.positions=s.positions.filter(p=>p.marketId!==resolution.marketId);s.settlements[resolution.marketId]={at:now,payouts:resolution.payouts,source:resolution.source};return true;
}
