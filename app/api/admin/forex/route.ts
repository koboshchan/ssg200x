import {endpoint} from "@/lib/api";
import {ensure} from "@/lib/errors";
import {readRoom} from "@/lib/db";
import {forexMarketOpen} from "@/lib/forex-policy";
export {PATCH as POST} from "../symbols/route";
export const GET=(request:Request)=>endpoint(request,async who=>{ensure(who.admin,"Administrator access required.",403);const r=await readRoom();return {forexStatus:{...(r.forexStatus??{mode:"unconfigured",dailyUsed:0,dailyLimit:800,message:"Twelve Data API key required."}),cadenceSeconds:r.forexCadenceSeconds??660,marketOpen:forexMarketOpen(Date.now())}};});
