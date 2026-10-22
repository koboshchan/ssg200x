import {forexDecision,forexMarketOpen} from "./forex-policy";
import {doudizhuAssets} from "./doudizhu";
import {publicPokerKickVote} from "./poker-kicks";
import {pokerTableRoom,pokerTablesView,seatedPokerTable,pokerMemberAssets,type PokerTableId} from "./poker-tables";
import {hideFromLeaderboard} from "./privacy-settings";
import {roomFeeRates} from "../runtime/perp-fee-policy.mjs";
import {checkInView} from "./check-in";
import {advancementView} from "./advancements";
import {casinoLimits} from "./casino-limits";
import {marketSummary} from "./market-summary";
import {marketSymbols} from "./symbol-registry";
import {createHash} from "node:crypto";
import {currentProfiles,currentNamedRoom} from "./server-names";
import {transferHistoryKey} from "./transfer-history-key";
import {publicStockState} from "./stock-room-policy";
import {DELISTED_SYMBOLS} from "./market-shared";
import {legacyQuote,stockExecutable} from "./finance";
import {skipCloseConfirmation,triggerInputMode} from "./trading-settings";
import {roulettePublic,rouletteAssets} from "./roulette";
import {blackjackTablesPublic,blackjackMemberAssets} from "./blackjack";
import {assetsMarket,portfolio,equity,pnl,netPnl,liqPrice,value} from "./finance";
import { legal, pot, seatOf, active } from "./poker";
import type { Room, Identity } from "./types";
// Wire windows only; persisted history and action identifiers remain untouched.
export const ROOM_WIRE_LIMITS={pokerLog:20,activity:12,spins:12} as const;
export function publicRoom(r:Room,who:Identity,tableId:PokerTableId="01") {
 const ledger=r;
 const table=pokerTableRoom(r,tableId);
 r={...r,...Object.fromEntries(["seats","button","street","handNumber","board","deck","currentBet","minRaise","pending","turn","deadline","nextDeal","readyDeadline","payouts","log","pokerBonus","pokerCarry","pokerDead"].map(k=>[k,table[k as keyof Room]]))} as Room;
 // Do not present corrupt/future cache as a redeemable legacy valuation.
 const quotes={...r.quotes};
 for(const symbol of marketSymbols(r).delisted)if(!legacyQuote(r,symbol))delete quotes[symbol];
 r={...r,quotes};
 const legacyAssets=marketSymbols(r).delisted.map(symbol=>({symbol,quote:legacyQuote(r,symbol),status:legacyQuote(r,symbol)?"delisted-cached":"pending-valuation"}));
 const me=portfolio(r.members.find(m=>m.id===who.id)!);
 const mySeat=seatOf(r,who.id),summary=marketSummary(r);
 return {
  forexQuotes:r.forexQuotes??{},forexStatus:{...(r.forexStatus??{mode:"unconfigured" as const,cadenceSeconds:660,dailyUsed:0,dailyLimit:800 as const,message:"Twelve Data key required."}),marketOpen:forexMarketOpen(Date.now())},forexExecution:Object.fromEntries(marketSymbols(r).forex.map(s=>[s,stockExecutable(r,s)?forexDecision(s,r.forexQuotes?.[s],r.forexStatus,Date.now()):{executable:false,reason:"fresh_live_USD_quote_required",validUntil:0}])),
  pokerKickVote:publicPokerKickVote(ledger,tableId),pokerTableId:tableId,pokerTables:pokerTablesView(ledger),pokerInPlay:(()=>{const id=seatedPokerTable(ledger,who.id);if(!id)return 0;const t=pokerTableRoom(ledger,id),s=t.seats.find(s=>s?.userId===who.id)!;return s.stack+(active(t)?s.committed:0)})(),
  perpsCloseAll:r.financeReceipts?.find(x=>x.userId===who.id&&x.closeAll)?.closeAll??null,
  receivedPayments:(r.members.find(m=>m.id===who.id)?.receivedPayments??[]).map(p=>({id:p.id,amount:p.amount,at:p.at,sender:r.members.find(m=>m.id===p.senderId)?.name??"Player"})),checkIn:checkInView(r.members.find(m=>m.id===who.id)!,Date.now()),advancements:advancementView(r.members.find(m=>m.id===who.id)),casinoLimits:casinoLimits(r),marketSymbols:marketSymbols(r),marketSummary:summary,marketChanges:Object.fromEntries(Object.entries(summary).map(([symbol,row])=>[symbol,row.change])),chatNames:r.members.map(m=>({publicId:m.publicId,name:m.name})),transferHistoryKeys:{mine:transferHistoryKey([me]),all:who.admin?transferHistoryKey(r.members):""},stockExecution:Object.fromEntries(Object.entries(publicStockState(r)).map(([symbol,{checkedAt:_,...state}])=>[symbol,state])),legacyAssets,roulette:roulettePublic(r,who),blackjack:blackjackTablesPublic(r,who),version:r.version,serverNow:Date.now(),limits:r.limits||{maxTrade:1000000,maxLeverage:200},adminUsers:who.admin?r.members.map(m=>{const s=r.seats.find(s=>s?.userId===m.id);return {publicId:m.publicId,name:m.name,approved:true,wallet:m.wallet,netWorth:m.wallet+assetsMarket(r,m)+blackjackMemberAssets(r,m.id)+rouletteAssets(r,m.id)+doudizhuAssets(ledger,m.id)+pokerMemberAssets(ledger,m.id),holdings:(m.holdings||[]).map(h=>({...h,value:r.quotes?.[h.symbol]?value(h.units,r.quotes[h.symbol]!.micro):h.cost})),positions:(m.positions||[]).map(p=>({...p,liquidation:liqPrice(p),pnl:r.quotes?.[p.symbol]?netPnl(p,r.quotes[p.symbol]!.micro):-(p.openingFee||0),equity:r.quotes?.[p.symbol]?equity(p,r.quotes[p.symbol]!.micro):(p.collateral??p.margin)}))};}):[],perpFeePpm:roomFeeRates(r).openingFeePpm,perpOpeningFeePpm:roomFeeRates(r).openingFeePpm,perpClosingFeePpm:roomFeeRates(r).closingFeePpm,perpClosingFeeMode:r.perpClosingFeeMode??"notional",maintenancePercent:100*(r.maintenance||0),adminPositions:who.admin?r.members.flatMap(m=>(m.positions||[]).map(p=>({publicId:m.publicId,name:m.name,id:p.id,symbol:p.symbol,side:p.side,leverage:p.leverage,entry:p.entry,liquidation:liqPrice(p)}))):[],quotes:r.quotes||{},holdings:me.holdings!.map(h=>({...h,value:r.quotes?.[h.symbol]?value(h.units,r.quotes[h.symbol]!.micro):h.cost})),positions:me.positions!.map(p=>({...p,liquidation:liqPrice(p),pnl:r.quotes?.[p.symbol]?netPnl(p,r.quotes[p.symbol]!.micro):-(p.openingFee||0),equity:r.quotes?.[p.symbol]?equity(p,r.quotes[p.symbol]!.micro):(p.collateral??p.margin)})),closedPositions:me.closedPositions!.map(({margin:_,...position})=>position),spins:me.spins!.slice(0,ROOM_WIRE_LIMITS.spins),activity:(me.activity||[]).slice(0,ROOM_WIRE_LIMITS.activity),me:{pokerKickCooldownUntil:ledger.pokerKickCooldowns?.[who.id]??0,hideFromLeaderboard:hideFromLeaderboard(me),skipCloseConfirmation:skipCloseConfirmation(me),triggerInputMode:triggerInputMode(me),publicId:me.publicId,name:me.name,approved:true,wallet:me.wallet,admin:who.admin,seat:mySeat,pokerTableId:seatedPokerTable(ledger,who.id)},
  handNumber:r.handNumber,street:r.street,board:r.board,button:r.button,pot:pot(r),currentBet:r.currentBet,minRaise:r.minRaise,
  turn:r.turn,deadline:r.deadline,nextDeal:r.nextDeal,readyDeadline:r.readyDeadline??null,payouts:r.payouts,log:r.log.slice(0,ROOM_WIRE_LIMITS.pokerLog),
  legal:mySeat>=0?legal(r,mySeat):null,
  seats:r.seats.map((s,i)=>{
   if(!s)return null;
   const m=r.members.find(m=>m.id===s.userId)!;
   const show=s.userId===who.id||(r.street==="showdown"&&r.nextDeal!==null&&Date.now()<r.nextDeal);
   return {seat:i,publicId:m.publicId,name:m.name,avatar:m.avatar??null,stack:s.stack,bet:s.bet,committed:s.committed,folded:s.folded,inHand:s.inHand,ready:s.ready===true,sitOut:s.sitOut,leaveAfter:s.leaveAfter,
    hole:show?s.hole:s.hole.map(()=>"?"),isYou:s.userId===who.id};
  }),
  leaderboard:r.members.filter(m=>!hideFromLeaderboard(m)).map(m=>{
   const s=r.seats.find(s=>s?.userId===m.id);
   const netWorth=m.wallet+assetsMarket(r,m)+blackjackMemberAssets(r,m.id)+rouletteAssets(r,m.id)+doudizhuAssets(ledger,m.id)+pokerMemberAssets(ledger,m.id);
   return {publicId:m.publicId,name:m.name,netWorth,pnl:netWorth-100_000-(m.adjustments||0)};
  }).sort((a,b)=>b.netWorth-a.netWorth||a.name.localeCompare(b.name)),
  pending:[],
  members:who.admin?r.members.filter(m=>m.id!==who.id).map(m=>({publicId:m.publicId,name:m.name,wallet:m.wallet})):[],
 };
}
export type PublicRoom=ReturnType<typeof publicRoom>;

// Production wire boundary: domain serializers only see current server labels.
export async function freshPublicRoom(r:Room,who:Identity,profiles?:import("../runtime/clerk-names.mjs").DisplayProfiles,tableId:PokerTableId="01"){
 profiles??=await currentProfiles(r.members.map(m=>m.id));
 return {...publicRoom(await currentNamedRoom(r,profiles),who,tableId),chatNames:[...profiles].map(([id,p])=>({publicId:createHash("sha256").update(id).digest("hex").slice(0,16),name:p.name}))};
}
