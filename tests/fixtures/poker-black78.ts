import {freshRoom,register} from "../../lib/poker";
import type {Identity,Room} from "../../lib/types";
export const pokerUser=(i:number):Identity=>({id:"black78_"+i,name:"Player "+i,email:i+"@test.invalid",admin:false});
export function pokerShowdown(contributions:number[],holes:string[][],folded:number[]=[]):Room {
 const r=freshRoom();r.street="river";r.handNumber=1;r.button=0;
 r.board=["Ah","Kh","Qh","Jh","2d"];
 contributions.forEach((amount,i)=>{
  register(r,pokerUser(i),1000);r.members[i].wallet=100000-amount;
  r.seats[i]={userId:pokerUser(i).id,stack:0,hole:holes[i],bet:amount,committed:amount,
   folded:folded.includes(i),inHand:true,actedAt:0,sitOut:false,leaveAfter:false,seen:1000};
 });
 return r;
}
