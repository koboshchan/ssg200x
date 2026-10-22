import {z} from "zod";
import {AppError,ensure} from "./errors";
import type {PolyMarket,PolyEvent,PolyBook,PolyLevel,PolyResolution} from "./polymarket-types";
const GAMMA="https://gamma-api.polymarket.com",CLOB="https://clob.polymarket.com";
type DataSlot={until:number;value?:unknown;error?:AppError;pending?:Promise<unknown>};
// App Router bundles can each load this module, keep one process-wide cache.
const shared=globalThis as typeof globalThis&{__polymarketDataSlots?:Map<string,DataSlot>};
const slots=shared.__polymarketDataSlots??=new Map<string,DataSlot>();
const raw=z.record(z.string(),z.unknown());
export const polyId=z.string().regex(/^\d{1,24}$/);
export const polyToken=z.string().regex(/^\d{1,80}$/);
export const polyInterval=z.enum(["1h","6h","1d","1w","1m","max"]);
export const QUOTE_TTL=10_000;
function record(x:unknown){return raw.parse(x);}
function text(x:unknown,max=20000){return typeof x==="string"?x.slice(0,max):"";}
function num(x:unknown){const n=Number(x);return Number.isFinite(n)&&n>=0?n:0;}
function array(x:unknown):unknown[]{if(typeof x==="string"){try{x=JSON.parse(x);}catch{return [];}}return Array.isArray(x)?x:[];}
function image(x:unknown){if(typeof x!=="string"||x.length>2048)return null;try{const u=new URL(x);return u.protocol==="https:"?u.href:null;}catch{return null;}}
/** Fixed-point decimals, never binary floating multiplication for execution. */
export function polyFixed(x:unknown,places=6):number{
 const s=String(x),m=/^(\d+)(?:\.(\d+))?$/.exec(s);ensure(m&&m[1].length<=16,"Invalid upstream decimal.",503);
 const fractional=m[2]??"";ensure(fractional.length<=places||/^0*$/.test(fractional.slice(places)),"Unsupported upstream precision.",503);
 const n=BigInt(m[1])*10n**BigInt(places)+BigInt((fractional.slice(0,places)+"0".repeat(places)).slice(0,places));
 ensure(n<=BigInt(Number.MAX_SAFE_INTEGER),"Upstream value is too large.",503);return Number(n);
}
async function get(path:string,ttl:number,fresh=false):Promise<unknown>{
 const now=Date.now(),old=slots.get(path);
 if(old?.pending)return structuredClone(await old.pending);
 if(!fresh&&old&&old.until>now){if(old.error)throw old.error;return structuredClone(old.value);}
 ensure([...slots.values()].filter(x=>x.pending).length<64,"Prediction data is busy. Try again.",503);
 if(slots.size>=512){for(const [key,value]of slots){if(!value.pending){slots.delete(key);break;}}}
 const entry:{until:number;value?:unknown;error?:AppError;pending?:Promise<unknown>}={until:0};
 const pending=(async()=>{
  try{
   const response=await fetch(path,{signal:AbortSignal.timeout(6000),cache:"no-store",redirect:"error",headers:{Accept:"application/json"}});
   ensure(response.ok,"Prediction data unavailable. Try again.",503);
   const reader=response.body?.getReader();ensure(reader,"Empty prediction response.",503);
   let size=0,body="";const decoder=new TextDecoder();
   try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;ensure(size<=6_000_000,"Prediction response too large.",503);body+=decoder.decode(part.value,{stream:true});}body+=decoder.decode();}
   finally{await reader.cancel();}
   const value:unknown=JSON.parse(body);entry.value=value;entry.until=Date.now()+ttl;return value;
  }catch{entry.error=new AppError("Prediction data unavailable. Try again.",503);entry.until=Date.now()+2000;throw entry.error;}
  finally{entry.pending=undefined;}
 })();entry.pending=pending;slots.set(path,entry);return structuredClone(await pending);
}
export function normalizePolyMarket(value:unknown,now=Date.now()):PolyMarket{
 const x=record(value),version=x.version==="v2"?"v2":x.version==="v1"||x.version==null?"v1":"unsupported";
 const labels=array(x.outcomes),prices=array(x.outcomePrices),ids=array(version==="v2"?x.positionIds:x.clobTokenIds);
 const outcomes=labels.slice(0,8).map((label,i)=>({label:text(label,100),tokenId:polyToken.safeParse(ids[i]).success?String(ids[i]):"",price:prices[i]!=null&&Number.isFinite(Number(prices[i]))&&Number(prices[i])>=0&&Number(prices[i])<=1?Number(prices[i]):null}));
 const supported=version!=="unsupported"&&outcomes.length===2&&outcomes.every(o=>o.tokenId)&&new Set(outcomes.map(o=>o.tokenId)).size===2;
 return {id:polyId.parse(String(x.id)),slug:text(x.slug,300),question:text(x.question,1000),description:text(x.description),image:image(x.image??x.icon),conditionId:text(x.conditionId,100),version,outcomes,active:x.active===true,closed:x.closed===true,acceptingOrders:supported&&x.active===true&&x.closed===false&&x.archived!==true&&x.acceptingOrders===true,endDate:typeof x.endDate==="string"?x.endDate:null,volume:num(x.volume),liquidity:num(x.liquidity),groupItemTitle:text(x.groupItemTitle,300),resolutionStatus:typeof x.resolutionStatus==="string"?x.resolutionStatus:typeof x.umaResolutionStatus==="string"?x.umaResolutionStatus:null,asOf:now};
}
function normalizeEvent(value:unknown):PolyEvent{
 const x=record(value);return {id:polyId.parse(String(x.id)),slug:text(x.slug,300),title:text(x.title,1000),description:text(x.description),image:image(x.image??x.icon),volume:num(x.volume),volume24hr:num(x.volume24hr),markets:array(x.markets).slice(0,150).flatMap(m=>{try{return [normalizePolyMarket(m)];}catch{return [];}}),tags:array(x.tags).slice(0,30).map(t=>{const r=record(t);return{id:text(String(r.id),30),label:text(r.label,100),slug:text(r.slug,100)};})};
}
export async function polyDiscover(q="",cursor="",tag=""){
 ensure(q.length<=120&&cursor.length<=2048&&/^\d{0,24}$/.test(tag),"Invalid discovery query.");
 let path:string;
 if(q){
  ensure(cursor===""||/^\d{1,4}$/.test(cursor),"Invalid search page.");
  path=GAMMA+"/public-search?"+new URLSearchParams({q,page:cursor||"1",limit_per_type:"20",search_profiles:"false",search_tags:"false",events_status:"active"});
 }else{
  const p=new URLSearchParams({closed:"false",limit:"20",order:"volume24hr",ascending:"false"});p.append("version","v1");p.append("version","v2");if(cursor)p.set("after_cursor",cursor);if(tag)p.set("tag_id",tag);path=GAMMA+"/events/keyset?"+p;
 }
 const x=record(await get(path,15_000)),events=array(x.events).slice(0,20).flatMap(e=>{try{return[normalizeEvent(e)];}catch{return[];}});
 const pagination=x.pagination?record(x.pagination):{};
 return {events,nextCursor:q?(pagination.hasMore===true?String(Number(cursor||"1")+1):null):typeof x.next_cursor==="string"?x.next_cursor:null,asOf:Date.now()};
}
export async function polyEvent(id:string){polyId.parse(id);return normalizeEvent(await get(GAMMA+"/events/"+id,10_000));}
export async function polyMarket(id:string,fresh=false){polyId.parse(id);return normalizePolyMarket(await get(GAMMA+"/markets/"+id,3000,fresh));}
function levels(x:unknown,side:"buy"|"sell"):PolyLevel[]{
 const list=array(x);ensure(list.length<=2000,"Order book too large.",503);
 const mapped=list.map(v=>{const l=record(v),priceMicros=polyFixed(l.price),shareMicros=polyFixed(l.size);ensure(priceMicros>0&&priceMicros<1e6,"Invalid order book price.",503);return{price:priceMicros/1e6,size:shareMicros/1e6,priceMicros,shareMicros};}).filter(x=>x.shareMicros>0);
 return mapped.sort((a,b)=>side==="buy"?a.priceMicros-b.priceMicros:b.priceMicros-a.priceMicros);
}
export function normalizePolyBook(value:unknown,tokenId:string,now=Date.now()):PolyBook{
 const x=record(value);ensure(x.asset_id===tokenId,"Mismatched outcome book.",503);
 const asOf=Number(x.timestamp);ensure(Number.isSafeInteger(asOf)&&asOf>0,"Invalid book timestamp.",503);
 return{tokenId,conditionId:text(x.market,100),bids:levels(x.bids,"sell"),asks:levels(x.asks,"buy"),asOf,fetchedAt:now,hash:text(x.hash,200)};
}
export async function polyBook(tokenId:string,fresh=false){polyToken.parse(tokenId);return normalizePolyBook(await get(CLOB+"/book?"+new URLSearchParams({token_id:tokenId}),750,fresh),tokenId);}
export async function polyChart(tokenId:string,interval="1d"){
 polyToken.parse(tokenId);polyInterval.parse(interval);
 const x=record(await get(CLOB+"/prices-history?"+new URLSearchParams({market:tokenId,interval,fidelity:interval==="max"?"720":interval==="1w"||interval==="1m"?"60":"5"}),30_000));
 return{history:array(x.history).slice(-5000).flatMap(v=>{const p=record(v);return Number.isSafeInteger(p.t)&&Number(p.t)>0&&Number.isFinite(p.p)&&Number(p.p)>=0&&Number(p.p)<=1?[{t:Number(p.t),p:Number(p.p)}]:[];}),asOf:Date.now()};
}
/** Closed alone, an end date, and a price near 1 are NEVER resolution evidence. */
export function normalizePolyResolution(market:PolyMarket,clob:unknown,now=Date.now()):PolyResolution|null{
 const c=record(clob),tokens=array(c.tokens).map(record);
 if(!market.closed||c.closed!==true||c.condition_id!==market.conditionId||tokens.length!==2)return null;
 const ids=market.outcomes.map(o=>o.tokenId);if(ids.length!==2||tokens.some(t=>!ids.includes(String(t.token_id)))||new Set(tokens.map(t=>t.token_id)).size!==2)return null;
 const winners=tokens.filter(t=>t.winner===true);
 let payouts:Record<string,number>,kind:"settle"|"void"="settle";
 if(winners.length===1&&tokens.every(t=>typeof t.winner==="boolean")){
  payouts=Object.fromEntries(tokens.map(t=>[String(t.token_id),t.winner?1_000_000:0]));
 }else return null;
 return{marketId:market.id,conditionId:market.conditionId,version:market.version,payouts,source:"gamma+clob-final",asOf:now,kind};
}
/** Data API v2 exposes final micro-USDC payouts for both protocols, including
 * 50/50 and derived negative-risk outcomes. Never guess these from market prices. */
export function normalizePolyDataResolution(market:PolyMarket,value:unknown,now=Date.now()):PolyResolution|null{
 if(!market.closed||market.version==="unsupported"||market.outcomes.length!==2)return null;
 const rows=array(record(value).data).map(record),matching=rows.filter(x=>x.condition_id===market.conditionId);
 if(matching.length!==1)return null;const row=matching[0],payouts=array(row.payouts);
 if(row.status!=="resolved"||row.extended_review===true||payouts.length!==2||!payouts.every(p=>typeof p==="number"&&Number.isSafeInteger(p)&&p>=0&&p<=1e6)||Number(payouts[0])+Number(payouts[1])!==1e6)return null;
 if(!market.outcomes.every(o=>polyToken.safeParse(o.tokenId).success))return null;
 return{marketId:market.id,conditionId:market.conditionId,version:market.version,payouts:Object.fromEntries(market.outcomes.map((o,i)=>[o.tokenId,Number(payouts[i])])),source:"data-v2-final",asOf:now,kind:"settle"};
}
export async function polyResolution(id:string){
 const market=await polyMarket(id,true);if(!market.closed)return null;
 ensure(/^0x[a-fA-F0-9]{64}$/.test(market.conditionId),"Unsupported market resolution.",503);
 const data=await get("https://data-api.polymarket.com/v2/resolutions?"+new URLSearchParams({condition:market.conditionId}),15_000,true);
 const result=normalizePolyDataResolution(market,data);if(result)return result;
 const matching=array(record(data).data).map(record).filter(x=>x.condition_id===market.conditionId);
 // Do not bypass a live dispute or malformed published payout using a second feed.
 if(matching.length>1||matching.some(x=>x.status!=="resolved"||x.extended_review===true||x.payouts!=null))return null;
 return normalizePolyResolution(market,await get(CLOB+"/markets/"+market.conditionId,15_000,true));
}
