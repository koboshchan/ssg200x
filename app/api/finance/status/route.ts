import {endpoint,parse} from "@/lib/api";
import {financeSchema} from "@/lib/finance-input";
import {mutate} from "@/lib/store";
import {reconcileFinanceRequest} from "@/lib/finance-requests";
import {freshPublicRoom} from "@/lib/public";
export const POST=(request:Request)=>endpoint(request,async who=>{
 const input=await parse(request,financeSchema);
 const {room,result}=await mutate(r=>reconcileFinanceRequest(r,who.id,input));
 return {outcome:result,room:await freshPublicRoom(room,who)};
});
