import {z} from "zod";
import {endpoint,parse} from "@/lib/api";
import {mutate,visit,rateLimit} from "@/lib/store";
import {miniAction,miniSnapshot,type MiniInput} from "@/lib/minigames";
import {wholeCasinoCents} from "@/lib/casino-schemas";
import {CASINO_LIMIT_MAX_CENTS} from "@/lib/casino-limits";
const base={requestId:z.string().uuid(),requestAt:z.number().int().safe()};
const session={...base,id:z.string().uuid(),revision:z.number().int().nonnegative().safe()};
const miniSchema=z.discriminatedUnion("type",[
 z.object({...base,type:z.literal("start"),game:z.enum(["plinko","hilo","mines","dice","chicken"]),amount:wholeCasinoCents.min(100).max(CASINO_LIMIT_MAX_CENTS),mines:z.number().int().min(1).max(10).optional(),target:z.number().int().min(2).max(98).optional(),direction:z.enum(["over","under"]).optional()}).strict(),
 z.object({...session,type:z.literal("step"),cell:z.number().int().min(0).max(24).optional(),choice:z.enum(["high","low"]).optional()}).strict(),
 z.object({...session,type:z.literal("cashout")}).strict(),
]);
export const GET=(request:Request)=>endpoint(request,async who=>miniSnapshot(await visit(who),who));
export const POST=(request:Request)=>endpoint(request,async who=>{
 await rateLimit("minigames:"+who.id,100);const input=await parse(request,miniSchema);
 const {room}=await mutate(room=>miniAction(room,who,input as MiniInput));return miniSnapshot(room,who);
});
