import {z} from "zod";
import {endpoint,parse} from "@/lib/api";
import {rateLimit} from "@/lib/store";
import {freshPublicRoom as publicRoom} from "@/lib/public";
import {BLACKJACK_TABLE_IDS} from "@/lib/blackjack";
import {blackjackMove} from "@/lib/blackjack-store";
const base={tableId:z.enum(BLACKJACK_TABLE_IDS),requestId:z.string().uuid(),requestAt:z.number().int(),round:z.number().int().optional(),deadline:z.number().int().nullable().optional()};
const schema=z.discriminatedUnion("type",[
 z.object({...base,type:z.literal("join"),seat:z.number().int().min(0).max(5)}).strict(),
 z.object({...base,type:z.literal("leave")}).strict(),
 z.object({...base,type:z.literal("bet"),amount:z.number().int().min(100).max(100000).refine(n=>n%2===0)}).strict(),
 ...(["hit","stand","double","split"] as const).map(type=>z.object({...base,type:z.literal(type)}).strict()),
]);
export const POST=(request:Request)=>endpoint(request,async who=>{
 await rateLimit("blackjack:"+who.id,60);const input=await parse(request,schema);
 const room=await blackjackMove(who,input);return publicRoom(room,who);
});
