import {roulettePublic,rouletteAssets} from "./roulette";
import {blackjackTablesPublic,blackjackMemberAssets} from "./blackjack";
import {assetsMarket,portfolio,equity,pnl,liqPrice,value} from "./finance";
import { legal, pot, seatOf, active } from "./poker";
import type { Room, Identity } from "./types";
export function publicRoom(r:Room,who:Identity) {
 const me=portfolio(r.members.find(m=>m.id===who.id)!);
 const mySeat=seatOf(r,who.id);
 return {
  roulette:roulettePublic(r,who),blackjack:blackjackTablesPublic(r,who),version:r.version,serverNow:Date.now(),limits:r.limits||{maxTrade:1000000,maxLeverage:200},adminUsers:who.admin?r.members.map(m=>{const s=r.seats.find(s=>s?.userId===m.id);return {publicId:m.publicId,name:m.name,email:m.email,approved:true,wallet:m.wallet,netWorth:m.wallet+assetsMarket(r,m)+blackjackMemberAssets(r,m.id)+rouletteAssets(r,m.id)+(s?s.stack+(active(r)?s.committed:0):0),holdings:(m.holdings||[]).map(h=>({...h,value:r.quotes?.[h.symbol]?value(h.units,r.quotes[h.symbol]!.micro):h.cost})),positions:(m.positions||[]).map(p=>({...p,liquidation:liqPrice(p),pnl:r.quotes?.[p.symbol]?pnl(p,r.quotes[p.symbol]!.micro):0,equity:r.quotes?.[p.symbol]?equity(p,r.quotes[p.symbol]!.micro):p.margin}))};}):[],maintenancePercent:100*(r.maintenance||0),adminPositions:who.admin?r.members.flatMap(m=>(m.positions||[]).map(p=>({publicId:m.publicId,name:m.name,id:p.id,symbol:p.symbol,side:p.side,leverage:p.leverage,entry:p.entry,liquidation:liqPrice(p)}))):[],quotes:r.quotes||{},holdings:me.holdings!.map(h=>({...h,value:r.quotes?.[h.symbol]?value(h.units,r.quotes[h.symbol]!.micro):h.cost})),positions:me.positions!.map(p=>({...p,liquidation:liqPrice(p),pnl:r.quotes?.[p.symbol]?pnl(p,r.quotes[p.symbol]!.micro):0,equity:r.quotes?.[p.symbol]?equity(p,r.quotes[p.symbol]!.micro):p.margin})),closedPositions:me.closedPositions!,spins:me.spins!,activity:me.activity||[],me:{publicId:me.publicId,name:me.name,approved:true,wallet:me.wallet,admin:who.admin,seat:mySeat},
  handNumber:r.handNumber,street:r.street,board:r.board,button:r.button,pot:pot(r),currentBet:r.currentBet,minRaise:r.minRaise,
  turn:r.turn,deadline:r.deadline,nextDeal:r.nextDeal,readyDeadline:r.readyDeadline??null,payouts:r.payouts,log:r.log,
  legal:mySeat>=0?legal(r,mySeat):null,
  seats:r.seats.map((s,i)=>{
   if(!s)return null;
   const m=r.members.find(m=>m.id===s.userId)!;
   const show=s.userId===who.id||(r.street==="showdown"&&r.board.length===5&&s.inHand&&!s.folded);
   return {seat:i,publicId:m.publicId,name:m.name,stack:s.stack,bet:s.bet,committed:s.committed,folded:s.folded,inHand:s.inHand,ready:s.ready===true,sitOut:s.sitOut,leaveAfter:s.leaveAfter,
    hole:show?s.hole:s.hole.map(()=>"?"),isYou:s.userId===who.id};
  }),
  leaderboard:r.members.map(m=>{
   const s=r.seats.find(s=>s?.userId===m.id);
   const netWorth=m.wallet+assetsMarket(r,m)+blackjackMemberAssets(r,m.id)+rouletteAssets(r,m.id)+(s?s.stack+(active(r)?s.committed:0):0);
   return {publicId:m.publicId,name:m.name,netWorth,pnl:netWorth-100_000-(m.adjustments||0)};
  }).sort((a,b)=>b.netWorth-a.netWorth||a.name.localeCompare(b.name)),
  pending:[],
  members:who.admin?r.members.filter(m=>m.id!==who.id).map(m=>({publicId:m.publicId,name:m.name,email:m.email,wallet:m.wallet})):[],
 };
}
export type PublicRoom=ReturnType<typeof publicRoom>;
