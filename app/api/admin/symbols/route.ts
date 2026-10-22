import {z} from "zod";
import {endpoint,parse} from "@/lib/api";
import {ensure} from "@/lib/errors";
import {readRoom} from "@/lib/db";
import {mutate,rateLimit} from "@/lib/store";
import {adminSymbolSnapshot,changeMarketSymbol,validateProviderSymbol} from "@/lib/admin-symbols";
import {validForexPair} from "@/lib/forex-policy";
import {SYMBOL_PATTERN} from "@/lib/symbol-registry";
const schema=z.object({action:z.enum(["add","remove"]),kind:z.enum(["crypto","stocks","forex"]),symbol:z.string().max(20),expectedVersion:z.number().int().nonnegative(),confirmed:z.boolean().optional()}).strict().refine(i=>i.kind==="forex"?validForexPair(i.symbol):SYMBOL_PATTERN.test(i.symbol),{message:"Invalid market symbol"});
export const GET=(request:Request)=>endpoint(request,async who=>{ensure(who.admin,"Administrator access required.",403);return adminSymbolSnapshot(await readRoom(),who);});
export const POST=(request:Request)=>endpoint(request,async who=>{
 ensure(who.admin,"Administrator access required.",403);
 await rateLimit("admin-symbols:"+who.id,20);
 const input=await parse(request,schema);
 ensure(input.kind!=="forex","Save the complete forex pair list instead.",409);
 if(input.action==="add")await validateProviderSymbol(input.kind,input.symbol);
 const {room}=await mutate(room=>changeMarketSymbol(room,who,input));
 return adminSymbolSnapshot(room,who);
});
