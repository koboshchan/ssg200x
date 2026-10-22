import {endpoint,parse} from '@/lib/api';
import {visit,mutate} from '@/lib/store';
import {z} from 'zod';
import {changePolymarketSettings,polyPortfolio} from '@/lib/polymarket';
import {viewSettings} from '@/lib/polymarket-view';
const body=z.object({enabled:z.boolean(),maxTradeCents:z.number().int().min(1).max(100_000_000),expectedVersion:z.unknown().optional()}).strict();
export const GET=(request:Request)=>endpoint(request,async who=>{const r=await visit(who);polyPortfolio(r,who);return viewSettings(r);});
export const POST=(request:Request)=>endpoint(request,async who=>{
 const i=await parse(request,body),{room}=await mutate(r=>changePolymarketSettings(r,who,{enabled:i.enabled,maxTrade:i.maxTradeCents}));
 return viewSettings(room);
});
