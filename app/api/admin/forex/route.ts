import {endpoint} from "@/lib/api";
import {ensure} from "@/lib/errors";
import {readRoom} from "@/lib/db";
import {forexMarketOpen} from "@/lib/forex-policy";
export const GET=(request:Request)=>endpoint(request,async who=>{ensure(who.admin,"Administrator access required.",403);const r=await readRoom();return {forexStatus:{...(r.forexStatus??{mode:"unconfigured",stream:"down",message:"OANDA practice credentials required."}),marketOpen:forexMarketOpen(Date.now())}};});
