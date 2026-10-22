/** Frontend-facing adapters over the prediction core. Cents/prices/decimal shares externally, micros internally. No image URLs are exposed. */
import {ensure} from "./errors";
import {polyBook,polyMarket,QUOTE_TTL} from "./polymarket-data";
import {fillPolymarket,polySettings} from "./polymarket";
import type {Room} from "./types";
import type {PolyEvent,PolyMarket,PolyHistory,PolyPosition,PolyBook} from "./polymarket-types";

export type Side="yes"|"no";
const isYes=(l:string)=>/^yes$/i.test(l);
/** yes = outcome labelled Yes, else the first outcome; no = the other one. */
export function outcomeFor(m:PolyMarket,side:Side){
 ensure(m.outcomes.length===2,"Unsupported market.",409);
 const yi=Math.max(0,m.outcomes.findIndex(o=>isYes(o.label)));
 return m.outcomes[side==="yes"?yi:1-yi];
}
export const sideOf=(m:{outcomes:{label:string;tokenId:string}[]},tokenId:string):Side=>{
 const yi=Math.max(0,m.outcomes.findIndex(o=>isYes(o.label)));return m.outcomes[yi]?.tokenId===tokenId?"yes":"no";
};
export function viewSettings(r:Room){const s=polySettings(r);return{enabled:s.enabled,maxTrade:s.maxTrade,maxTradeCents:s.maxTrade};}
export function viewMarket(m:PolyMarket){
 const y=m.outcomes.length===2?outcomeFor(m,"yes"):m.outcomes[0],n=m.outcomes.length===2?outcomeFor(m,"no"):m.outcomes[1];
 return{id:m.id,question:m.groupItemTitle||m.question,fullQuestion:m.question,outcomes:[y,n].filter(Boolean).map(o=>({label:o.label,price:o.price??0})),volume:m.volume,liquidity:m.liquidity,closed:m.closed||!m.acceptingOrders,endDate:m.endDate};
}
export function viewEvent(e:PolyEvent,extra:Record<string,unknown>={}){
 const markets=e.markets.filter(m=>m.outcomes.length===2&&m.version!=="unsupported");
 rememberEvents([e]);return{id:e.id,title:e.title,category:e.tags.find(t=>t.label&&!/^(all|featured|trending)$/i.test(t.label))?.label,volume:e.volume,volume24hr:e.volume24hr,liquidity:markets.reduce((s,m)=>s+m.liquidity,0),endDate:markets.map(m=>m.endDate).filter(Boolean).sort()[0]??null,closed:markets.length===0||markets.every(m=>m.closed||!m.acceptingOrders),description:e.description,markets:markets.map(viewMarket),...extra};
}
const tagIds=new Map<string,string>();
export function rememberTags(events:PolyEvent[]){for(const e of events)for(const t of e.tags)if(t.label&&t.id&&tagIds.size<500)tagIds.set(t.label,t.id);}
export const tagIdFor=(label:string)=>tagIds.get(label)??"";
export function categoriesSeen(){return [...tagIds.keys()].filter(l=>!/^(all|featured|trending|hide from new)$/i.test(l)).slice(0,14);}

export type Quote={price:number;shares:number;cents:number;asOf:number;serverNow:number;tradable:boolean;reason?:string};
export function quoteFrom(book:PolyBook,market:PolyMarket,action:"buy"|"sell",amount:number,enabled:boolean,now=Date.now()):Quote{
 const asOf=Math.min(book.asOf,market.asOf);
 const fail=(reason:string):Quote=>({price:0,shares:0,cents:0,asOf,serverNow:now,tradable:false,reason});
 if(!enabled)return fail("Trading is off.");
 if(!market.acceptingOrders||market.closed||market.version==="unsupported")return fail("Market is not accepting trades.");
 if(now-book.asOf>QUOTE_TTL||now-book.fetchedAt>QUOTE_TTL||now-market.asOf>QUOTE_TTL)return fail("Live price is stale.");
 try{
  const f=fillPolymarket(book,action,amount,action==="buy"?0.999999:0.000001);
  return{price:f.averagePrice,shares:f.shareMicros/1e6,cents:f.amount,asOf,serverNow:now,tradable:true};
 }catch(e){return fail(e instanceof Error?e.message:"No liquidity.");}
}
export async function liveQuote(r:Room,marketId:string,side:Side,action:"buy"|"sell",amountCents?:number,shares?:number){
 const market=await polyMarket(marketId,true),token=outcomeFor(market,side).tokenId,book=await polyBook(token,true);
 const amount=action==="buy"?amountCents:Math.round((shares??0)*1e6);
 ensure(Number.isSafeInteger(amount)&&(amount as number)>0,"Invalid amount.");
 return quoteFrom(book,market,action,amount as number,polySettings(r).enabled);
}
export function viewHistory(h:PolyHistory,m?:{outcomes:{label:string;tokenId:string}[]}){
 const shares=h.shareMicros/1e6;
 return{t:h.at,type:h.action==="void"?"settle":h.action,marketId:h.marketId,question:h.question,side:m?sideOf(m,h.tokenId):h.outcome,shares,price:shares>0?h.amount/100/shares:0,cents:h.amount};
}
const eventIds=new Map<string,{id:string;title:string}>();
/** Market to event index, filled from event listings/detail already fetched through the shared cache. No extra upstream calls. */
export function rememberEvents(events:PolyEvent[]){for(const e of events)for(const m of e.markets){if(eventIds.size>5000)eventIds.clear();eventIds.set(m.id,{id:e.id,title:e.title});}}
/** Open positions are valued from live books (fresh by book.asOf AND fetchedAt). Anything not freshly priced
 * (stale book, fetch failure, or beyond the 40-position cap) is valued at cost, with priceLive:false so the UI labels it stale.
 * Settled/void rows are reconstructed from history with the actual payout and cost. */
export const PORTFOLIO_LIVE_CAP=40;
export async function viewPortfolio(r:Room,userId:string,wallet:number,history:PolyHistory[],positions:PolyPosition[],now=Date.now()){
 const open=positions.slice(0,PORTFOLIO_LIVE_CAP),tokens=[...new Set(open.map(p=>p.tokenId))],markets=[...new Set(open.map(p=>p.marketId))];
 const books=new Map<string,PolyBook|null>(),mk=new Map<string,PolyMarket|null>();
 const pool=async(items:string[],fn:(x:string)=>Promise<void>)=>{for(let i=0;i<items.length;i+=6)await Promise.all(items.slice(i,i+6).map(x=>fn(x).catch(()=>{})));};
 await Promise.all([pool(tokens,async t=>{books.set(t,await polyBook(t).catch(()=>null));}),pool(markets,async id=>{mk.set(id,await polyMarket(id).catch(()=>null));})]);
 const out=positions.map((p,i)=>{
  const m=mk.get(p.marketId),book=i<PORTFOLIO_LIVE_CAP?books.get(p.tokenId):null,shares=p.shareMicros/1e6,avg=p.cost/100/shares,ev=eventIds.get(p.marketId);
  let valueCents=p.cost,cur=avg,live=false;
  if(book&&now-book.asOf<=QUOTE_TTL&&now-book.fetchedAt<=QUOTE_TTL){
   try{const f=fillPolymarket(book,"sell",p.shareMicros,0.000001);valueCents=f.amount;cur=f.averagePrice;live=true;}
   catch{const bid=book.bids[0];if(bid){cur=bid.price;valueCents=Math.floor(shares*cur*100);live=true;}}
  }
  return{marketId:p.marketId,eventId:ev?.id,eventTitle:ev?.title,question:p.question,side:m?sideOf(m,p.tokenId):(isYes(p.outcome)?"yes":"no"),outcome:p.outcome,shares,avgPrice:avg,curPrice:cur,costCents:p.cost,valueCents,pnlCents:valueCents-p.cost,status:"open" as const,priceLive:live};
 });
 const settled=history.filter(h=>h.action==="settle"||h.action==="void").slice(0,60).map(h=>{
  const shares=h.shareMicros/1e6,avg=shares>0?h.cost/100/shares:0,ev=eventIds.get(h.marketId);
  return{marketId:h.marketId,eventId:ev?.id,eventTitle:ev?.title,question:h.question,side:isYes(h.outcome)?"yes" as const:"no" as const,outcome:h.outcome,shares,avgPrice:avg,curPrice:shares>0?h.amount/100/shares:0,costCents:h.cost,valueCents:h.amount,pnlCents:h.amount-h.cost,status:(h.action==="void"?"void":h.amount>0?"won":"lost") as "void"|"won"|"lost",priceLive:true,at:h.at};
 });
 const ms=new Map([...mk].filter(([,x])=>x) as [string,PolyMarket][]);
 return{wallet,positions:[...out,...settled],activity:history.slice(0,60).map(h=>viewHistory(h,ms.get(h.marketId)))};
}
