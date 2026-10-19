import {randomInt,randomUUID} from "node:crypto";
import {ensure} from "./errors";
import {register} from "./poker";
import type {Room,Identity,Member} from "./types";
export {SYMBOLS,RED} from "./market-shared";
import {type Symbol,type Bet,RED} from "./market-shared";
export type {Symbol,Bet} from "./market-shared";
export type Quote={micro:number;at:number};
export type Holding={symbol:Symbol;units:number;cost:number};
export type Position={id:string;symbol:Symbol;side:"long"|"short";margin:number;leverage:number;entry:number;opened:number;maintenance?:number;liquidationOverride?:number};
export type Spin={id:string;number:number;stake:number;returned:number;at:number};
export function portfolio(m:Member){m.holdings??=[];m.positions??=[];m.spins??=[];return m;}
export function value(units:number,micro:number){return Number(BigInt(units)*BigInt(micro)/1_000_000_000_000n);}
export function unitsFor(cents:number,micro:number){return Number(BigInt(cents)*1_000_000_000_000n/BigInt(micro));}
export function pnl(p:Position,mark:number){return Math.floor(p.margin*p.leverage*(mark-p.entry)/p.entry*(p.side==="long"?1:-1));}
export function liqPrice(p:Position){if(p.liquidationOverride!==undefined)return p.liquidationOverride;const m=p.maintenance||0;return p.side==="long"?p.entry*(1-1/p.leverage)/(1-m):p.entry*(1+1/p.leverage)/(1+m);}
export function liquidatable(p:Position,mark:number){return p.side==="long"?mark<=liqPrice(p):mark>=liqPrice(p);}
export function equity(p:Position,mark:number){return Math.max(0,p.margin+pnl(p,mark));}
export function requireQuote(r:Room,symbol:Symbol,now=Date.now()){
 const q=r.quotes?.[symbol];ensure(q&&Number.isSafeInteger(q.micro)&&q.micro>0&&now-q.at<=10_000&&now>=q.at,"Live price unavailable. Trading is paused.",503);return q.micro;
}
function settle(r:Room,m:Member,p:Position,mark:number,force=false){
 const returned=force||liquidatable(p,mark)?0:equity(p,mark);
 ensure(Number.isSafeInteger(returned)&&returned<1e12,"Position exceeds simulation limit.");
 m.wallet+=returned;r.house=(r.house||0)+p.margin-returned;m.positions=m.positions!.filter(x=>x.id!==p.id);
 m.activity=[(returned===0?"Liquidated ":"Closed ")+p.side+" "+p.symbol+" · "+(returned/100).toFixed(2)+" returned",...(m.activity||[])].slice(0,40);
}
export function liquidate(r:Room,now=Date.now()){
 for(const member of r.members){const m=portfolio(member);for(const p of [...m.positions!]){
 const q=r.quotes?.[p.symbol];if(q&&now-q.at<=10_000&&liquidatable(p,q.micro))settle(r,m,p,q.micro,true);
 }}
}
export function spot(r:Room,who:Identity,symbol:Symbol,side:"buy"|"sell",amount:number,now=Date.now()){
 const m=portfolio(register(r,who));ensure(m.approved,"Account approval required.",403);
 const price=requireQuote(r,symbol,now);
 ensure(Number.isSafeInteger(amount)&&amount>=100&&amount<=100_000_000,"Use $1–$1,000,000 per order.");
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
export function openPosition(r:Room,who:Identity,symbol:Symbol,side:"long"|"short",margin:number,leverage:number,id:string=randomUUID(),now=Date.now()){
 const m=portfolio(register(r,who));ensure(m.approved,"Account approval required.",403);
 const entry=requireQuote(r,symbol,now);ensure(Number.isSafeInteger(margin)&&margin>=100&&margin<=100_000_000&&m.wallet>=margin,"Not enough cash or invalid margin.");
 ensure(Number.isInteger(leverage)&&leverage>=1&&leverage<=50,"Leverage must be 1–50x.");ensure((r.maintenance||0)<1/leverage,"Chosen leverage requires more initial margin than maintenance margin.");ensure(m.positions!.length<20,"Close a position first.");
 m.wallet-=margin;m.positions!.push({id,symbol,side,margin,leverage,entry,opened:now,maintenance:r.maintenance||0});
}
export function closePosition(r:Room,who:Identity,id:string,now=Date.now()){
 const m=portfolio(register(r,who));ensure(m.approved,"Account approval required.",403);const p=m.positions!.find(x=>x.id===id);ensure(p,"Position not found.",404);settle(r,m,p,requireQuote(r,p.symbol,now));
}
export function payout(b:Bet,n:number){
 ensure(Number.isInteger(n)&&n>=0&&n<=36,"Invalid wheel result.");
 ensure(Number.isSafeInteger(b.amount)&&b.amount>=100&&b.amount<=100_000,"Bet $1–$1,000.");
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
 const m=portfolio(register(r,who));ensure(m.approved,"Account approval required.",403);
 ensure(bets.length>=1&&bets.length<=20,"Choose 1–20 bets.");
 const returned=bets.reduce((sum,b)=>sum+payout(b,n),0),stake=bets.reduce((sum,b)=>sum+b.amount,0);
 ensure(stake<=100_000&&m.wallet>=stake,"Not enough cash or total bet over $1,000.");
 ensure(!m.spins![0]||now-m.spins![0].at>=1500,"Wait a moment before spinning again.",429);
 m.wallet+=returned-stake;r.house=(r.house||0)+stake-returned;
 m.spins=[{id,number:n,stake,returned,at:now},...m.spins!].slice(0,30);
}
export function assetsBook(m:Member){return (m.holdings||[]).reduce((n,h)=>n+h.cost,0)+(m.positions||[]).reduce((n,p)=>n+p.margin,0);}
export function assetsMarket(r:Room,m:Member){return (m.holdings||[]).reduce((n,h)=>n+(r.quotes?.[h.symbol]?value(h.units,r.quotes[h.symbol]!.micro):h.cost),0)+(m.positions||[]).reduce((n,p)=>n+(r.quotes?.[p.symbol]?equity(p,r.quotes[p.symbol]!.micro):p.margin),0);}
