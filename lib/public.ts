import { legal, pot, seatOf, active } from "./poker";
import type { Room, Identity } from "./types";
export function publicRoom(r:Room,who:Identity) {
 const me=r.members.find(m=>m.id===who.id)!;
 const mySeat=seatOf(r,who.id);
 return {
  version:r.version,serverNow:Date.now(),me:{publicId:me.publicId,name:me.name,approved:me.approved,wallet:me.wallet,admin:who.admin,seat:mySeat},
  handNumber:r.handNumber,street:r.street,board:r.board,button:r.button,pot:pot(r),currentBet:r.currentBet,minRaise:r.minRaise,
  turn:r.turn,deadline:r.deadline,nextDeal:r.nextDeal,payouts:r.payouts,log:r.log,
  legal:mySeat>=0?legal(r,mySeat):null,
  seats:r.seats.map((s,i)=>{
   if(!s)return null;
   const m=r.members.find(m=>m.id===s.userId)!;
   const show=s.userId===who.id||(r.street==="showdown"&&r.board.length===5&&s.inHand&&!s.folded);
   return {seat:i,publicId:m.publicId,name:m.name,stack:s.stack,bet:s.bet,committed:s.committed,folded:s.folded,inHand:s.inHand,sitOut:s.sitOut,leaveAfter:s.leaveAfter,
    hole:show?s.hole:s.hole.map(()=>"?"),isYou:s.userId===who.id};
  }),
  leaderboard:r.members.filter(m=>m.approved).map(m=>{
   const s=r.seats.find(s=>s?.userId===m.id);
   const netWorth=m.wallet+(s?s.stack+(active(r)?s.committed:0):0);
   return {publicId:m.publicId,name:m.name,netWorth,pnl:netWorth-100_000};
  }).sort((a,b)=>b.netWorth-a.netWorth||a.name.localeCompare(b.name)),
  pending:who.admin?r.members.filter(m=>!m.approved).map(m=>({publicId:m.publicId,name:m.name,email:m.email})):[],
  members:who.admin?r.members.filter(m=>m.approved&&m.id!==who.id).map(m=>({publicId:m.publicId,name:m.name,email:m.email})):[],
 };
}
export type PublicRoom=ReturnType<typeof publicRoom>;
