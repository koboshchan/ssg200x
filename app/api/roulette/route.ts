import {rouletteBetSchema as bet} from "@/lib/casino-schemas";
import {z} from 'zod';
import {endpoint,parse} from '@/lib/api';
import {rateLimit} from '@/lib/store';
import {freshPublicRoom as publicRoom} from '@/lib/public';
import {rouletteMove} from '@/lib/roulette-store';
const base={requestId:z.string().uuid(),requestAt:z.number().int(),round:z.number().int().min(1)};
const schema=z.discriminatedUnion('type',[
 z.object({...base,type:z.literal('rebet')}).strict(),
 z.object({...base,type:z.literal('bet'),bet}).strict(),
 z.object({...base,type:z.literal('change'),betId:z.string().uuid(),bet}).strict(),
 z.object({...base,type:z.literal('cancel'),betId:z.string().uuid()}).strict(),
]);
export const POST=(request:Request)=>endpoint(request,async who=>{await rateLimit('roulette:'+who.id,120);const input=await parse(request,schema);return publicRoom(await rouletteMove(who,input,input.round,input.requestId,input.requestAt),who);});
