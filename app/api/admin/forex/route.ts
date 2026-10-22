import {endpoint} from "@/lib/api";
import {ensure} from "@/lib/errors";
import {readRoom} from "@/lib/db";
import {forexMarketOpen} from "@/lib/forex-policy";
export const GET=(request:Request)=>endpoint(request,async who=>{ensure(who.admin,"Administrator access required.",403);const r=await readRoom();return {forexStatus:{...(r.forexStatus??{mode:"unconfigured",stream:"down",message:"OANDA practice credentials required."}),marketOpen:forexMarketOpen(Date.now())}};});

import {parse} from '@/lib/api';
import {z} from 'zod';
import {mutate} from '@/lib/store';
import {adminSymbolSnapshot,replaceForexPairs,validateForexPairs} from '@/lib/admin-symbols';
import {validForexPair} from '@/lib/forex-policy';
const listSchema=z.object({pairs:z.array(z.string().refine(validForexPair)).max(8).refine(p=>new Set(p).size===p.length),expectedVersion:z.number().int().nonnegative(),confirmed:z.boolean().optional()}).strict();
export const PUT=(request:Request)=>endpoint(request,async who=>{
 ensure(who.admin,'Administrator access required.',403);
 const input=await parse(request,listSchema);
 await validateForexPairs(input.pairs);
 const {room}=await mutate(room=>replaceForexPairs(room,who,input.pairs,input.expectedVersion,input.confirmed===true));
 return adminSymbolSnapshot(room,who);
});
