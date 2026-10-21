import type {Room,Member} from "./types";
export const CHECK_IN_REWARDS=[5000,5000,10000,5000,10000,20000,20000] as const;
export type CheckInState={day:string;streak:number;claimedAt:number;bannerDay?:string};
const formatter=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Vancouver",year:"numeric",month:"2-digit",day:"2-digit"});
export function checkInDay(now:number){return formatter.format(now);}
function priorDay(day:string){const date=new Date(day+"T12:00:00Z");date.setUTCDate(date.getUTCDate()-1);return date.toISOString().slice(0,10);}
export function checkInView(member:Pick<Member,"checkIn">,now:number){
 const today=checkInDay(now),old=member.checkIn,claimed=old?.day===today;
 const streak=claimed?old.streak:old?.day===priorDay(today)?old.streak+1:1;
 return {day:today,streak,claimed,reward:CHECK_IN_REWARDS[Math.min(streak,7)-1],bannerShown:old?.bannerDay===today};
}
export function markCheckInBanner(member:Member,now:number){
 const view=checkInView(member,now);if(view.bannerShown)return false;
 member.checkIn={day:member.checkIn?.day??"",streak:member.checkIn?.streak??0,claimedAt:member.checkIn?.claimedAt??0,bannerDay:view.day};return !view.claimed;
}
export function claimCheckIn(room:Room,member:Member,now:number){
 const view=checkInView(member,now);if(view.claimed)return view;
 member.checkIn={day:view.day,streak:view.streak,claimedAt:now,bannerDay:view.day};
 member.wallet+=view.reward;room.issuance=(room.issuance??0)+view.reward;member.adjustments=(member.adjustments??0)+view.reward;
 room.auditPending??=[];room.auditPending.push({_id:"check-in:"+member.id+":"+view.day,who:member.id,what:"daily-check-in",target:member.id,old:null,new:{day:view.day,streak:view.streak,reward:view.reward},at:now});
 return {...view,claimed:true,bannerShown:true};
}
