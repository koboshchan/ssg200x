import type {Member} from "./types";
// Quotes, positions, chips and cash-only trading must not invalidate transfer history.
// Adjustments distinguish repeated identical payments after the activity ring fills.
export function transferHistoryKey(members:(Pick<Member,"publicId"|"adjustments"|"activity"> & Partial<Pick<Member,"name">>)[]){
 return JSON.stringify(members.map(m=>[m.publicId,m.name??"",m.adjustments??0,(m.activity??[]).filter(a=>/^(Sent \$|Received \$|Airdrop \+)/.test(a))]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
}
