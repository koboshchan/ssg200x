import {POKER_SEAT_ORDER} from "./poker-seats";
export type PokerTableId="01"|"02"|"03";
export type PokerTableSummary={id:PokerTableId;name:string;seatsFilled:number;seatCount:number;street:string;handNumber:number};
export const POKER_TABLE_IDS:PokerTableId[]=["01","02","03"];
const KEY="pokerTableId";
export function isPokerTableId(v:unknown):v is PokerTableId{return v==="01"||v==="02"||v==="03";}
export function readPokerTableId():PokerTableId{try{const v=window.sessionStorage.getItem(KEY);return isPokerTableId(v)?v:"01";}catch{return "01";}}
export function writePokerTableId(id:PokerTableId){try{window.sessionStorage.setItem(KEY,id);}catch{}}

export const POKER_MAX_SEATS=12;
export const POKER_BASE_SEATS=6;
/** Seat ids shown: every occupied seat, padded with the lowest empty ids up to 6, plus one next join seat when 6 or more are occupied. Ordered by canonical clockwise POKER_SEAT_ORDER. Nothing is hidden or reindexed. */
export function visibleSeatIds(seats:ReadonlyArray<unknown|null|undefined>,cap:number=POKER_MAX_SEATS):number[]{
 const n=Math.min(cap,seats.length||cap,POKER_MAX_SEATS);
 const ids=new Set<number>();for(let i=0;i<n;i++)if(seats[i])ids.add(i);
 const want=ids.size>=POKER_BASE_SEATS?ids.size+1:POKER_BASE_SEATS;
 for(let i=0;i<n&&ids.size<want;i++)if(!ids.has(i))ids.add(i);
 return POKER_SEAT_ORDER.filter(i=>i<n&&ids.has(i));
}
export const visibleSeatCount=(seats:ReadonlyArray<unknown|null|undefined>,cap?:number)=>visibleSeatIds(seats,cap).length;
/** Initial six-seat table (ids 0-5) keeps the legacy fixed CSS positions. */
export const isLegacyLayout=(ids:readonly number[])=>ids.length===POKER_BASE_SEATS&&ids.every(i=>i<POKER_BASE_SEATS);
export type SeatSlot={index:number;x:number;y:number};
export const isDenseTable=(count:number)=>count>POKER_BASE_SEATS;
/** Desktop wrapper height in px for a dense (7-12 seat) table. */
export const denseTableHeight=(count:number)=>560+(count-POKER_BASE_SEATS)*30;
/** Seat centres in percent of the wrapper, clockwise from the top; index i keeps its slot identity (no remap of occupied seats). */
export function denseSeatSlots(count:number):SeatSlot[]{
 if(count>POKER_BASE_SEATS){
  // Seven or more seats follow the long stadium felt: spread them evenly along a rounded rectangle, clockwise from the top.
  const X0=11,X1=89,Y0=9,Y1=91,w=X1-X0,h=Y1-Y0,per=2*(w+h);
  return Array.from({length:count},(_,i)=>{let d=((i+.5)*per/count+w/2)%per,x:number,y:number;
   if(d<w){x=X0+d;y=Y0}else if((d-=w)<h){x=X1;y=Y0+d}else if((d-=h)<w){x=X1-d;y=Y1}else{d-=w;x=X0;y=Y1-d}
   return {index:i,x:+x.toFixed(2),y:+y.toFixed(2)};});
 }
 return Array.from({length:count},(_,i)=>{const a=-Math.PI/2+Math.PI/count+2*Math.PI*i/count;return {index:i,x:+(50+39*Math.cos(a)).toFixed(2),y:+(50+41*Math.sin(a)).toFixed(2)};});
}
export function slotsOverlap(count:number,width:number,seatW:number,seatH:number):boolean{
 const h=denseTableHeight(count),s=denseSeatSlots(count);
 for(let i=0;i<s.length;i++)for(let j=i+1;j<s.length;j++)if(Math.abs((s[i].x-s[j].x)*width/100)<seatW&&Math.abs((s[i].y-s[j].y)*h/100)<seatH)return true;
 return false;
}
