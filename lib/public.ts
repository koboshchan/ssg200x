import {hideFromLeaderboard} from "./privacy-settings";
import {DEFAULT_PERP_FEE_PPM} from "../runtime/perp-fee-policy.mjs";
import {checkInView} from "./check-in";
import {advancementView} from "./advancements";
import {casinoLimits} from "./casino-limits";
import {marketSymbols} from "./symbol-registry";
import {createHash} from "node:crypto";
import {currentProfiles,currentNamedRoom} from "./server-names";
import {transferHistoryKey} from "./transfer-history-key";
import {publicStockState} from "./stock-room-policy";
import {DELISTED_SYMBOLS} from "./market-shared";
import {legacyQuote} from "./finance";
import {triggerInputMode} from "./trading-settings";
import {roulettePublic,rouletteAssets} from "./roulette";
import {blackjackTablesPublic,blackjackMemberAssets} from "./blackjack";
import {assetsMarket,portfolio,equity,pnl,liqPrice,value} from "./finance";
import { legal, pot, seatOf, active } from "./poker";
import type { Room, Identity } from "./types";
// Wire windows only; persisted history and action identifiers remain untouched.
export const ROOM_WIRE_LIMITS={pokerLog:20,activity:12,spins:12} as const;
export function publicRoom(r:Room,who:Identity) {
 // Do not present corrupt/future cache as a redeemable legacy valuation.
 const quotes={...r.quotes};
 for(const symbol of marketSymbols(r).delisted)if(!legacyQuote(r,symbol))delete quotes[symbol];
 r={...r,quotes};
 const legacyAssets=marketSymbols(r).delisted.map(symbol=>({symbol,quote:legacyQuote(r,symbol),status:legacyQuote(r,symbol)?"delisted-cached":"pending-valuation"}));
 const me=portfolio(r.members.find(m=>m.id===who.id)!);
 const mySeat=seatOf(r,who.id);
 return {
  receivedPayments:(r.members.find(m=>m.id===who.id)?.receivedPayments??[]).map(p=>({id:p.id,amount:p.amount,at:p.at,sender:r.members.find(m=>m.id===p.senderId)?.name??"Player"})),checkIn:checkInView(r.members.find(m=>m.id===who.id)!,Date.now()),advancements:advancementView(r.members.find(m=>m.id===who.id)),casinoLimits:casinoLimits(r),marketSymbols:marketSymbols(r),marketChanges:Object.fromEntries([...marketSymbols(r).crypto,...marketSymbols(r).stocks].map(symbol=>{
   const base=r.marketDay?.[symbol],quote=r.quotes?.[symbol],today=new Date().toISOString().slice(0,10);
   return [symbol,base?.day===today&&base.open>0&&quote?(quote.micro/base.open-1)*100:null];
  })),chatNames:r.members.map(m=>({publicId:m.publicId,name:m.name})),transferHistoryKeys:{mine:transferHistoryKey([me]),all:who.admin?transferHistoryKey(r.members):""},stockExecution:Object.fromEntries(Object.entries(publicStockState(r)).map(([symbol,{checkedAt:_,...state}])=>[symbol,state])),legacyAssets,roulette:roulettePublic(r,who),blackjack:blackjackTablesPublic(r,who),version:r.version,serverNow:Date.now(),limits:r.limits||{maxTrade:1000000,maxLeverage:200},adminUsers:who.admin?r.members.map(m=>{const s=r.seats.find(s=>s?.userId===m.id);return {publicId:m.publicId,name:m.name,approved:true,wallet:m.wallet,netWorth:m.wallet+assetsMarket(r,m)+blackjackMemberAssets(r,m.id)+rouletteAssets(r,m.id)+(s?s.stack+(active(r)?s.committed:0):0),holdings:(m.holdings||[]).map(h=>({...h,value:r.quotes?.[h.symbol]?value(h.units,r.quotes[h.symbol]!.micro):h.cost})),positions:(m.positions||[]).map(p=>({...p,liquidation:liqPrice(p),pnl:r.quotes?.[p.symbol]?pnl(p,r.quotes[p.symbol]!.micro):0,equity:r.quotes?.[p.symbol]?equity(p,r.quotes[p.symbol]!.micro):p.margin}))};}):[],perpFeePpm:r.perpFeePpm??DEFAULT_PERP_FEE_PPM,maintenancePercent:100*(r.maintenance||0),adminPositions:who.admin?r.members.flatMap(m=>(m.positions||[]).map(p=>({publicId:m.publicId,name:m.name,id:p.id,symbol:p.symbol,side:p.side,leverage:p.leverage,entry:p.entry,liquidation:liqPrice(p)}))):[],quotes:r.quotes||{},holdings:me.holdings!.map(h=>({...h,value:r.quotes?.[h.symbol]?value(h.units,r.quotes[h.symbol]!.micro):h.cost})),positions:me.positions!.map(p=>({...p,liquidation:liqPrice(p),pnl:r.quotes?.[p.symbol]?pnl(p,r.quotes[p.symbol]!.micro):0,equity:r.quotes?.[p.symbol]?equity(p,r.quotes[p.symbol]!.micro):p.margin})),closedPositions:me.closedPositions!.map(({margin:_,...position})=>position),spins:me.spins!.slice(0,ROOM_WIRE_LIMITS.spins),activity:(me.activity||[]).slice(0,ROOM_WIRE_LIMITS.activity),me:{hideFromLeaderboard:hideFromLeaderboard(me),triggerInputMode:triggerInputMode(me),publicId:me.publicId,name:me.name,approved:true,wallet:me.wallet,admin:who.admin,seat:mySeat},
  handNumber:r.handNumber,street:r.street,board:r.board,button:r.button,pot:pot(r),currentBet:r.currentBet,minRaise:r.minRaise,
  turn:r.turn,deadline:r.deadline,nextDeal:r.nextDeal,readyDeadline:r.readyDeadline??null,payouts:r.payouts,log:r.log.slice(0,ROOM_WIRE_LIMITS.pokerLog),
  legal:mySeat>=0?legal(r,mySeat):null,
  seats:r.seats.map((s,i)=>{
   if(!s)return null;
   const m=r.members.find(m=>m.id===s.userId)!;
   const show=s.userId===who.id||(r.street==="showdown"&&r.nextDeal!==null&&Date.now()<r.nextDeal);
   return {seat:i,publicId:m.publicId,name:m.name,stack:s.stack,bet:s.bet,committed:s.committed,folded:s.folded,inHand:s.inHand,ready:s.ready===true,sitOut:s.sitOut,leaveAfter:s.leaveAfter,
    hole:show?s.hole:s.hole.map(()=>"?"),isYou:s.userId===who.id};
  }),
  leaderboard:r.members.filter(m=>!hideFromLeaderboard(m)).map(m=>{
   const s=r.seats.find(s=>s?.userId===m.id);
   const netWorth=m.wallet+assetsMarket(r,m)+blackjackMemberAssets(r,m.id)+rouletteAssets(r,m.id)+(s?s.stack+(active(r)?s.committed:0):0);
   return {publicId:m.publicId,name:m.name,netWorth,pnl:netWorth-100_000-(m.adjustments||0)};
  }).sort((a,b)=>b.netWorth-a.netWorth||a.name.localeCompare(b.name)),
  pending:[],
  members:who.admin?r.members.filter(m=>m.id!==who.id).map(m=>({publicId:m.publicId,name:m.name,wallet:m.wallet})):[],
 };
}
export type PublicRoom=ReturnType<typeof publicRoom>;

// Production wire boundary: domain serializers only see current server labels.
export async function freshPublicRoom(r:Room,who:Identity,profiles?:import("../runtime/clerk-names.mjs").DisplayProfiles){
 profiles??=await currentProfiles(r.members.map(m=>m.id));
 return {...publicRoom(await currentNamedRoom(r,profiles),who),chatNames:[...profiles].map(([id,p])=>({publicId:createHash("sha256").update(id).digest("hex").slice(0,16),name:p.name}))};
}
