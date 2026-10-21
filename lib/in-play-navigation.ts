import type {PublicRoom} from "./public";

/** Book-value exposure on the current game only. Never mutates or settles money. */
export function moneyInPlay(room:PublicRoom|null,pathname:string|null):number {
 if(!room)return 0;
 if(pathname==="/poker"||pathname?.startsWith("/poker/")){
  if(typeof room.pokerInPlay==="number")return room.pokerInPlay;
  const seat=room.seats[room.me.seat];
  if(!seat?.isYou)return 0;
  const active=room.street!=="waiting"&&room.street!=="showdown";
  return seat.stack+(active?seat.committed:0);
 }
 if(pathname==="/blackjack"||pathname?.startsWith("/blackjack/"))return room.blackjack.tables.reduce((sum,table)=>{
  const seat=table.seats[table.mySeat];
  if(!seat?.isYou||table.phase==="settled")return sum;
  return sum+(table.phase==="betting"?seat.bet:seat.hands.reduce((n,hand)=>n+hand.bet,0));
 },0);
 if(pathname==="/roulette"||pathname?.startsWith("/roulette/")){
  if(!room.roulette||room.roulette.phase==="result")return 0;
  return room.roulette.bets.reduce((sum,wager)=>sum+(wager.isYou?wager.bet.amount:0),0);
 }
 return 0;
}

/** Same-document/hash/query links do not leave the game. */
export function internalLeaveTarget(anchor:HTMLAnchorElement,current:URL):string|null {
 if(anchor.hasAttribute("download")||(anchor.target&&anchor.target.toLowerCase()!=="_self"))return null;
 const href=anchor.getAttribute("href");
 if(!href)return null;
 let target:URL;
 try{target=new URL(href,current);}catch{return null;}
 if(target.origin!==current.origin||!/^https?:$/.test(target.protocol)||target.pathname===current.pathname)return null;
 return target.pathname+target.search+target.hash;
}
