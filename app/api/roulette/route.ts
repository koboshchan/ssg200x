import {rouletteRequestSchema as schema} from "@/lib/roulette-request";
import {endpoint,parse} from '@/lib/api';
import {rateLimit} from '@/lib/store';
import {freshPublicRoom as publicRoom} from '@/lib/public';
import {rouletteMove} from '@/lib/roulette-store';
export const POST=(request:Request)=>endpoint(request,async who=>{await rateLimit('roulette:'+who.id,120);const input=await parse(request,schema);return publicRoom(await rouletteMove(who,input,input.round,input.requestId,input.requestAt),who);});
