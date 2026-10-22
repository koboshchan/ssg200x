import {forexLiveConfigured,forexMonotonic,forexClockDomain} from "./forex-config";
import {forexDecision} from "./forex-policy";
import {forexSymbol} from "./symbol-registry";
import {quoteFresh} from "./price-policy";
import {roomFeeRates,positionFeeRates,closingFeeMode,closingFeeReserve,closingFeeCents} from "../runtime/perp-fee-policy.mjs";
import {openingFeeCents} from "./perp-fees";
import {casinoLimits,CASINO_LIMIT_MAX_CENTS} from "./casino-limits";
import {marketSymbols,activeSymbol,delistedSymbol,stockSymbol} from "./symbol-registry";
import {isWholeCasinoAmount} from "./casino-amount";
import {stockExecutionPolicy,type StockExecutionState} from "./stock-policy";
import {randomInt,randomUUID} from "node:crypto";
import {ensure} from "./errors";
import {validateTriggers,type PositionTriggers} from "./position-triggers";
import {register} from "./poker";
import type {Room,Identity,Member} from "./types";
export {SYMBOLS,RED} from "./market-shared";
import {type Symbol,type Bet,RED} from "./market-shared";
export type {Symbol,Bet} from "./market-shared";
export type Quote={micro:number;at:number};
export type Holding={symbol:Symbol;units:number;cost:number};
/** New positions size notional on margin after opening fees; postedMargin records the wallet debit.
 * Absent collateral retains the pre-migration wallet-paid opening fee behavior. */
export type Position={fx?:{units:number;quoteUsd:number};id:string;symbol:Symbol;side:"long"|"short";margin:number;postedMargin?:number;collateral?:number;leverage:number;entry:number;opened:number;feePpm?:number;openingFeePpm?:number;closingFeePpm?:number;closingFeeMode?:"notional"|"profit";openingFee?:number;maintenance?:number;liquidationOverride?:number;takeProfit?:number;stopLoss?:number;revision?:number;closingFeeRoundUp?:boolean};
export type ClosedPosition={id:string;symbol:Symbol;side:"long"|"short";leverage:number;entry:number;exit:number;margin:number;postedMargin?:number;collateral?:number;realizedPnl:number;openingFeePpm?:number;closingFeePpm?:number;closingFeeMode?:"notional"|"profit";openingFee?:number;closingFee?:number;assessedClosingFee?:number;waivedClosingFee?:number;reason:"TP"|"SL"|"Liq"|"Manual";closedAt:number};
export type Spin={id:string;number:number;stake:number;returned:number;at:number};
export function portfolio(m:Member){m.holdings??=[];m.positions??=[];m.spins??=[];m.closedPositions??=[];return m;}
export function value(units:number,micro:number){return Number(BigInt(units)*BigInt(micro)/1_000_000_000_000n);}
export function unitsFor(cents:number,micro:number){return Number(BigInt(cents)*1_000_000_000_000n/BigInt(micro));}
export function pnl(p:Position,mark:number){if(p.fx)return Math.floor(p.fx.units*(mark-p.entry)/1e6*(p.symbol.startsWith("USD/")?1e6/mark:p.fx.quoteUsd)*(p.side==="long"?1:-1));return Math.floor(p.margin*p.leverage*(mark-p.entry)/p.entry*(p.side==="long"?1:-1));}
export function liqPrice(p:Position){if(p.liquidationOverride!=null)return p.liquidationOverride;const m=(p.maintenance||0)+closingFeeReserve(p);if(p.fx){const sign=p.side==="long"?1:-1,Q=p.fx.units,C=p.collateral??p.margin;if(p.symbol.startsWith("USD/")){const d=C+sign*Q-m*Q;return d===0?Infinity:Math.max(0,sign*Q*p.entry/d);}const k=Q*p.fx.quoteUsd/1e6;return Math.max(0,(sign*k*p.entry-C)/(k*(sign-m)));}return p.side==="long"?p.entry*(1-(p.collateral??p.margin)/(p.margin*p.leverage))/(1-m):p.entry*(1+(p.collateral??p.margin)/(p.margin*p.leverage))/(1+m);}
export function liquidatable(p:Position,mark:number){return p.side==="long"?mark<=liqPrice(p):mark>=liqPrice(p);}
export function netPnl(p:Position,mark:number){const gross=equity(p,mark),fee=closingFeeCents(p,mark,pnl(p,mark),liquidatable(p,mark));return (liquidatable(p,mark)?0:Math.max(0,gross-fee))-(p.postedMargin??p.margin)-(p.collateral===undefined?(p.openingFee||0):0);}
export function equity(p:Position,mark:number){return Math.max(0,(p.collateral??p.margin)+pnl(p,mark));}
/** Same server guard for every stock settlement path; unknown state preserves claims. */
export function stockExecutable(r:Room,symbol:string,now=Date.now()){
 if(forexSymbol(symbol,r)){const q=r.forexQuotes?.[symbol],mark=r.quotes?.[symbol];return forexLiveConfigured()&&forexDecision(symbol,q,r.forexStatus,now,forexMonotonic(),forexClockDomain).executable&&!!q&&!!mark&&mark.micro===q.micro&&mark.at===q.at;}
 if(!stockSymbol(symbol,r))return true;
 const state=(r as Room & {stockExecution?:Partial<Record<string,StockExecutionState>>}).stockExecution?.[symbol];
 const quote=r.quotes?.[symbol as Symbol];
 return !!state&&Number.isFinite(state.leaseUntil)&&now<state.leaseUntil!&&state.symbol===symbol&&stockExecutionPolicy(state,now,marketSymbols(r).stocks).executable&&!!quote&&
   !!state.tick&&quote.micro===Math.round(state.tick.price*1e6)&&quote.at===state.tick.timestamp;
}
export function requireQuote(r:Room,symbol:Symbol,now=Date.now()){
 ensure(!forexSymbol(symbol,r)||stockExecutable(r,symbol,now),"Forex paused: fresh live stream and USD conversion required.",503);
 ensure(stockExecutable(r,symbol,now),"Stock market closed or verified live state unavailable.",503);
 const q=r.quotes?.[symbol];ensure(q&&Number.isSafeInteger(q.micro)&&q.micro>0&&quoteFresh(q.at,now,stockSymbol(symbol,r)),"Live price unavailable. Trading is paused.",503);return q.micro;
}
/** Only server-persisted USD quote cache is a settlement source, never USDT candles.
 * Missing/invalid cache retains the original claim without any financial mutation.
 */
export function legacyQuote(r:Room,symbol:Symbol,now=Date.now()){
 const q=r.quotes?.[symbol];
 return !forexSymbol(symbol,r)&&delistedSymbol(symbol,r)&&q&&Number.isSafeInteger(q.micro)&&q.micro>0&&q.micro<=1e13&&Number.isSafeInteger(q.at)&&q.at>=0&&q.at<=now?q:null;
}
export function requireLegacyQuote(r:Room,symbol:Symbol,now=Date.now()){
 const q=legacyQuote(r,symbol,now);ensure(q,"Delisted asset pending valuation. Your claim is retained.",503);return q;
}
export function redeemLegacyHolding(r:Room,who:Identity,symbol:Symbol,now=Date.now()){
 ensure(delistedSymbol(symbol,r),"Asset is not delisted.");
 const m=r.members.find(m=>m.id===who.id),h=m?.holdings?.find(h=>h.symbol===symbol);
 ensure(m&&h&&h.units>0,"No holding to redeem.",404);
 const q=requireLegacyQuote(r,symbol,now),returned=value(h.units,q.micro);
 ensure(Number.isSafeInteger(returned)&&returned>0&&returned<1e12,"Cached valuation cannot redeem this claim. Claim retained.",503);
 const old={...h,quote:{...q},wallet:m.wallet};
 m.wallet+=returned;r.house=(r.house||0)+h.cost-returned;
 m.holdings=m.holdings!.filter(x=>x!==h);
 m.activity=[`Redeemed delisted ${symbol} · ${(returned/100).toFixed(2)} returned · cached USD quote ${q.micro} at ${q.at}`,...(m.activity||[])].slice(0,40);
 return {old,returned,quote:{...q},wallet:m.wallet};
}
export function settle(r:Room,m:Member,p:Position,mark:number,reason:ClosedPosition["reason"],now:number){
 const isLiquidation=reason==="Liq"||liquidatable(p,mark);
 const assessedClosingFee=closingFeeCents(p,mark,pnl(p,mark),isLiquidation);
 const grossReturn=equity(p,mark);
 // Liquidation already forfeits the margin; its fee is allocated within that
 // forfeiture, never charged a second time to cash. Gaps are insured by house.
 const closingFee=Math.min(assessedClosingFee,isLiquidation?(p.collateral??p.margin):grossReturn);
 const returned=isLiquidation?0:Math.max(0,grossReturn-closingFee);
 ensure(Number.isSafeInteger(returned)&&returned<1e12,"Position exceeds simulation limit.");
 m.wallet+=returned;r.house=(r.house||0)+(p.collateral??p.margin)-returned;m.positions=m.positions!.filter(x=>x.id!==p.id);
 m.closedPositions=[{id:p.id,symbol:p.symbol,side:p.side,leverage:p.leverage,entry:p.entry,exit:mark,margin:p.margin,...(p.postedMargin!==undefined?{postedMargin:p.postedMargin}:{}),...(p.collateral!==undefined?{collateral:p.collateral}:{}),realizedPnl:returned-(p.postedMargin??p.margin)-(p.collateral===undefined?(p.openingFee||0):0),...((p.feePpm!==undefined||p.openingFeePpm!==undefined||p.closingFeePpm!==undefined)?{...positionFeeRates(p),...(p.closingFeeMode!==undefined?{closingFeeMode:p.closingFeeMode}:{}),openingFee:p.openingFee||0,closingFee,assessedClosingFee,waivedClosingFee:assessedClosingFee-closingFee}:{}),reason:isLiquidation?"Liq":reason,closedAt:now},...(m.closedPositions||[])];
 m.activity=[(isLiquidation?"Liquidated ":"Closed ")+p.side+" "+p.symbol+" · "+(returned/100).toFixed(2)+" returned · fees "+(((p.openingFee||0)+closingFee)/100).toFixed(2)+" · position "+p.id,...(m.activity||[])].slice(0,40);
}
export function liquidate(r:Room,now=Date.now()){
 for(const m of r.members){for(const p of [...(m.positions||[])]){
 const q=r.quotes?.[p.symbol];if(stockExecutable(r,p.symbol,now)&&activeSymbol(p.symbol,r)&&q&&Number.isSafeInteger(q.micro)&&q.micro>0&&quoteFresh(q.at,now,stockSymbol(p.symbol,r))&&liquidatable(p,q.micro))settle(r,m,p,q.micro,"Liq",now);
 }}
}
export function spotMark(r:Room,symbol:string){return forexSymbol(symbol,r)?r.forexQuotes?.[symbol]?.usdMicro:r.quotes?.[symbol]?.micro;}
export function requireSpotQuote(r:Room,symbol:Symbol,now=Date.now()){requireQuote(r,symbol,now);const price=spotMark(r,symbol);ensure(price&&Number.isSafeInteger(price)&&price>0,"Fresh USD conversion unavailable.",503);return price;}
export function spot(r:Room,who:Identity,symbol:Symbol,side:"buy"|"sell",amount:number,now=Date.now()){
 ensure(activeSymbol(symbol,r),"Asset is delisted. New orders are disabled.",410);
 const m=portfolio(register(r,who));
 const price=requireSpotQuote(r,symbol,now);
 ensure(Number.isSafeInteger(amount)&&amount>=100&&amount<=100_000_000,"Use $1–$1,000,000 per order.");
 ensure(amount<=(r.limits?.maxTrade??1000000)*100,"Order exceeds the host’s trade limit.");
 let h=m.holdings!.find(h=>h.symbol===symbol);
 if(side==="buy"){
 ensure(m.wallet>=amount,"Not enough cash.");const units=unitsFor(amount,price);ensure(units>0&&Number.isSafeInteger(units),"Order too small or too large.");
 m.wallet-=amount;if(!h){h={symbol,units:0,cost:0};m.holdings!.push(h);}h.units+=units;h.cost+=amount;
 }else{
 ensure(h&&h.units>0,"No holding to sell.");
 const units=Math.min(h.units,unitsFor(amount,price));ensure(units>0,"Order too small.");
 const cost=units===h.units?h.cost:Math.floor(h.cost*units/h.units),returned=value(units,price);
 ensure(returned>0,"Order too small.");h.units-=units;h.cost-=cost;m.wallet+=returned;r.house=(r.house||0)+cost-returned;
 if(h.units===0)m.holdings=m.holdings!.filter(x=>x!==h);
 }
}
export function openPosition(r:Room,who:Identity,symbol:Symbol,side:"long"|"short",margin:number,leverage:number,id:string=randomUUID(),now=Date.now(),triggers:PositionTriggers={}){
 ensure(activeSymbol(symbol,r),"Asset is delisted. New orders are disabled.",410);
 const m=portfolio(register(r,who));
 ensure(!m.positions!.some(p=>p.id===id)&&!m.closedPositions!.some(p=>p.id===id),"Position request already executed.",409);
 const entry=requireQuote(r,symbol,now);ensure(Number.isSafeInteger(margin)&&margin>=100&&margin<=100_000_000&&m.wallet>=margin,"Not enough cash or invalid margin.");
 ensure(margin<=(r.limits?.maxTrade??1000000)*100&&margin*leverage<=(r.limits?.maxTrade??1000000)*100,"Position margin or notional exceeds the host’s trade limit.");
 ensure(Number.isInteger(leverage)&&leverage>=1&&leverage<=(r.limits?.maxLeverage??200),"Leverage must be 1–200x.");ensure((r.maintenance||0)<1/leverage,"Chosen leverage requires more initial margin than maintenance margin.");ensure(m.positions!.length<20,"Close a position first.");
 const {openingFeePpm,closingFeePpm}=roomFeeRates(r),mode=closingFeeMode(r),reserve=mode==="profit"?0:closingFeePpm/1e6;
 ensure((r.maintenance||0)+reserve<1/leverage,"Chosen leverage leaves insufficient margin after the closing fee reserve.");
 const openingFee=openingFeeCents(margin,leverage,openingFeePpm);
 const collateral=margin-openingFee;
 ensure(collateral>0,"Posted margin cannot cover the opening fee.");
 ensure(collateral>collateral*leverage*((r.maintenance||0)+reserve),"Chosen leverage leaves insufficient collateral after opening fee and closing fee reserve.");
 const position:Position={...(forexSymbol(symbol,r)?{fx:{units:collateral*leverage/(entry/1e6*r.forexQuotes![symbol].quoteUsd!),quoteUsd:r.forexQuotes![symbol].quoteUsd!}}:{}),postedMargin:margin,collateral,openingFeePpm,closingFeePpm,...(mode==="profit"?{closingFeeMode:mode}:{}),openingFee,id,symbol,side,margin:collateral,leverage,entry,opened:now,maintenance:r.maintenance||0,...(triggers.takeProfit!=null?{takeProfit:triggers.takeProfit}:{}),...(triggers.stopLoss!=null?{stopLoss:triggers.stopLoss}:{})};
 validateTriggers(position);
 m.wallet-=margin;r.house=(r.house||0)+openingFee;m.positions!.push(position);
}
export function closePosition(r:Room,who:Identity,id:string,now=Date.now(),reason:ClosedPosition["reason"]="Manual"){
 const m=r.members.find(m=>m.id===who.id);const p=m?.positions?.find(x=>x.id===id);ensure(m&&p,"Position not found.",404);settle(r,m,p,delistedSymbol(p.symbol,r)?requireLegacyQuote(r,p.symbol,now).micro:requireQuote(r,p.symbol,now),reason,now);
}
export function payout(b:Bet,n:number,maxAmount=100_000){
 ensure(Number.isInteger(n)&&n>=0&&n<=36,"Invalid wheel result.");
 ensure(Number.isSafeInteger(b.amount)&&b.amount>=100&&b.amount<=maxAmount,"Bet exceeds the allowed limit.");
 let win=false,mult=2;
 if(b.kind==="straight"){ensure(Number.isInteger(b.pick)&&b.pick!>=0&&b.pick!<=36,"Pick 0–36.");win=n===b.pick;mult=36;}
 else if(b.kind==="dozen"||b.kind==="column"){ensure(Number.isInteger(b.pick)&&b.pick!>=1&&b.pick!<=3,"Pick 1–3.");win=n!==0&&(b.kind==="dozen"?Math.ceil(n/12)===b.pick:(n-1)%3+1===b.pick);mult=3;}
 else if(b.kind==="red")win=RED.has(n);
 else if(b.kind==="black")win=n!==0&&!RED.has(n);
 else if(b.kind==="odd")win=n!==0&&n%2===1;
 else if(b.kind==="even")win=n!==0&&n%2===0;
 else if(b.kind==="low")win=n>=1&&n<=18;
 else if(b.kind==="high")win=n>=19;
 else ensure(false,"Invalid bet.");
 return win?b.amount*mult:0;
}
export function spin(r:Room,who:Identity,bets:Bet[],n=randomInt(37),id:string=randomUUID(),now=Date.now()){
 const m=portfolio(register(r,who));
 ensure(bets.length>=1&&bets.length<=20,"Choose 1–20 bets.");
 ensure(bets.every(b=>isWholeCasinoAmount(b.amount)),"Bets must be whole dollars.");
 const returned=bets.reduce((sum,b)=>sum+payout(b,n,CASINO_LIMIT_MAX_CENTS),0),stake=bets.reduce((sum,b)=>sum+b.amount,0);
 ensure(stake<=casinoLimits(r).rouletteMaxTotal&&m.wallet>=stake,"Not enough cash or total bet exceeds the roulette limit.");
 ensure(!m.spins![0]||now-m.spins![0].at>=1500,"Wait a moment before spinning again.",429);
 m.wallet+=returned-stake;r.house=(r.house||0)+stake-returned;
 m.spins=[{id,number:n,stake,returned,at:now},...m.spins!].slice(0,30);
}
export function assetsBook(m:Member){return (m.holdings||[]).reduce((n,h)=>n+h.cost,0)+(m.positions||[]).reduce((n,p)=>n+(p.collateral??p.margin),0);}
export function assetsMarket(r:Room,m:Member){
 const quotes={...r.quotes};for(const symbol of Object.keys(quotes) as Symbol[])if(delistedSymbol(symbol,r)&&!legacyQuote(r,symbol))delete quotes[symbol];
 r={...r,quotes};return (m.holdings||[]).reduce((n,h)=>n+(r.quotes?.[h.symbol]?value(h.units,spotMark(r,h.symbol)!):h.cost),0)+(m.positions||[]).reduce((n,p)=>n+(r.quotes?.[p.symbol]?equity(p,r.quotes[p.symbol]!.micro):(p.collateral??p.margin)),0);}
