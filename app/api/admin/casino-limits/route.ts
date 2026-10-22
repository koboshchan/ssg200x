import {z} from "zod";
import {endpoint,parse} from "@/lib/api";
import {ensure} from "@/lib/errors";
import {readRoom} from "@/lib/db";
import {mutate,rateLimit} from "@/lib/store";
import {adminCasinoSnapshot,changeCasinoLimits} from "@/lib/admin-casino-limits";
import {CASINO_LIMIT_MAX_CENTS} from "@/lib/casino-limits";
const limit=z.number().int().min(100).max(CASINO_LIMIT_MAX_CENTS).multipleOf(100);
const casinoLimitSchema=z.object({rouletteMaxTotal:limit,blackjackMaxHand:limit,gamesMaxBet:limit.optional(),pokerMaxBuyIn:limit.min(10_000).optional(),pokerEggPrice:limit.optional(),pokerTomatoPrice:limit.optional(),expectedVersion:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER-1)}).strict();
export const GET=(request:Request)=>endpoint(request,async who=>{
 ensure(who.admin===true,"Administrator access required.",403);
 return adminCasinoSnapshot(await readRoom(),who);
});
export const POST=(request:Request)=>endpoint(request,async who=>{
 ensure(who.admin===true,"Administrator access required.",403);
 await rateLimit("admin-casino-limits:"+who.id,20);
 const input=await parse(request,casinoLimitSchema);
 const {room}=await mutate(room=>changeCasinoLimits(room,who,input));
 return adminCasinoSnapshot(room,who);
});
