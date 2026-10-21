import {validTradeLimit} from "./trade-limit";
import {roomFeeRates,closingFeeMode,type ClosingFeeMode} from "../runtime/perp-fee-policy.mjs";
import {validFeePercent} from "./perp-fees";
import {playerReference} from "../runtime/clerk-names.mjs";
import {audit} from "./audit";
import {liqPrice,liquidate} from "./finance";
import {register,addLog} from "./poker";
import {ensure} from "./errors";
import type {Identity,Room} from "./types";
export function adjustBalance(r:Room,who:Identity,target:string,delta:number){
 ensure(who.admin,"Administrator access required.",403);
 register(r,who);
 const m=r.members.find(x=>x.publicId===target);ensure(m,"Account not found.",404);
 ensure(Number.isSafeInteger(delta)&&delta!==0&&Math.abs(delta)<=100_000_000,"Adjustment must be nonzero and at most $1,000,000.");
 ensure(m.wallet+delta>=0&&m.wallet+delta<=1_000_000_000,"Resulting cash balance must be between $0 and $10,000,000.");
 const old=m.wallet;
 m.wallet+=delta;r.issuance=(r.issuance||0)+delta;m.adjustments=(m.adjustments||0)+delta;
 audit(r,who,"balance",m.id,old,m.wallet);
 addLog(r,"Host adjusted "+playerReference(m)+"'s cash by "+(delta/100).toFixed(2));
}
export function setMaintenance(r:Room,who:Identity,percent:number){
 ensure(who.admin,"Administrator access required.",403);ensure(Number.isFinite(percent)&&percent>=0&&percent<=20,"Maintenance margin must be 0–20%.");
 audit(r,who,"maintenance-margin","global",100*(r.maintenance||0),percent);
 r.maintenance=percent/100;
 for(const m of r.members)for(const p of m.positions||[])p.maintenance=r.maintenance;
 liquidate(r);
}
export function setLiquidation(r:Room,who:Identity,target:string,id:string,price:number){
 ensure(who.admin,"Administrator access required.",403);const m=r.members.find(m=>m.publicId===target),p=m?.positions?.find(p=>p.id===id);
 ensure(m&&p,"Position not found.",404);ensure(Number.isFinite(price)&&price>0&&price<=10_000_000,"Enter a valid USD liquidation price.");
 const micro=Math.round(price*1e6);ensure(micro>0&&Number.isSafeInteger(micro),"Invalid price.");
 audit(r,who,"liquidation-price",m.id+"/"+id,liqPrice(p)/1e6,price);p.liquidationOverride=micro;liquidate(r);
}
export function setLimits(r:Room,who:Identity,maxTrade:number,maxLeverage:number){
 ensure(who.admin,"Administrator access required.",403);ensure(validTradeLimit(maxTrade),"Trade limit must be a positive finite dollar amount to the cent within safe ledger precision.");
 ensure(Number.isInteger(maxLeverage)&&maxLeverage>=1&&maxLeverage<=200,"Leverage cap must be 1–200x.");
 const limits={maxTrade,maxLeverage};audit(r,who,"trading-limits","global",r.limits||{maxTrade:1000000,maxLeverage:200},limits);r.limits=limits;
}

// Keep the member ledger and historical ownership; never delete the denial.
export function setMemberAccess(r:Room,who:Identity,publicId:string,allowed:boolean){
 ensure(who.admin,"Administrator access required.",403);
 const member=r.members.find(m=>m.publicId===publicId);
 ensure(member,"Account not found.",404);
 ensure(member.id!==who.id,"Cannot revoke your own access.",409);
 if(!allowed&&!member.accessRevoked)r.chatRemovalVersion=(r.chatRemovalVersion||0)+1;
 audit(r,who,"member-access",publicId,!member.accessRevoked,allowed);
 member.accessRevoked=!allowed;member.approved=allowed;
}

export function setPerpFee(r:Room,who:Identity,percent:number){
 ensure(who.admin,"Administrator access required.",403);
 ensure(validFeePercent(percent),"Perpetual fee must be 0–0.1% per side, with at most four decimal places.");
 const ppm=Math.round(percent*10000);
 audit(r,who,"perpetual-trading-fee","global",roomFeeRates(r),ppm);
 r.perpFeePpm=ppm;r.perpOpeningFeePpm=ppm;r.perpClosingFeePpm=ppm;r.perpClosingFeeMode="notional";
}

/** Validate both legs before writing either; zero is a valid override. */
export function setPerpFees(r:Room,who:Identity,openingPercent:number,closingPercent:number,mode:ClosingFeeMode=closingFeeMode(r)){
 ensure(who.admin,"Administrator access required.",403);
 ensure(mode==="notional"||mode==="profit","Invalid closing fee mode.");
 ensure(validFeePercent(openingPercent)&&Number.isFinite(closingPercent)&&closingPercent>=0&&closingPercent<=(mode==="profit"?100:0.1)&&Math.abs(closingPercent*10000-Math.round(closingPercent*10000))<1e-7,"Opening fee must be 0–0.1%; closing fee must be 0–0.1% of notional or 0–100% of profit, with at most four decimal places.");
 const next={openingFeePpm:Math.round(openingPercent*10000),closingFeePpm:Math.round(closingPercent*10000)};
 audit(r,who,"perpetual-trading-fees","global",{...roomFeeRates(r),closingFeeMode:closingFeeMode(r)},{...next,closingFeeMode:mode});
 r.perpOpeningFeePpm=next.openingFeePpm;r.perpClosingFeePpm=next.closingFeePpm;r.perpClosingFeeMode=mode;
}
