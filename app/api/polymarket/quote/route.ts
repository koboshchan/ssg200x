import {endpoint} from '@/lib/api';
import {visit} from '@/lib/store';
import {z} from 'zod';
import {polyId} from '@/lib/polymarket-data';
import {polyPortfolio} from '@/lib/polymarket';
import {liveQuote} from '@/lib/polymarket-view';
const q=z.object({marketId:polyId,side:z.enum(['yes','no']),action:z.enum(['buy','sell']),amountCents:z.coerce.number().int().positive().optional(),shares:z.coerce.number().positive().max(1e9).optional()});
export const GET=(request:Request)=>endpoint(request,async who=>{
 const r=await visit(who);polyPortfolio(r,who);
 const x=q.parse(Object.fromEntries(new URL(request.url).searchParams));
 if(x.action==='buy'&&!x.amountCents||x.action==='sell'&&!x.shares)throw new Error('Missing amount.');
 return liveQuote(r,x.marketId,x.side,x.action,x.amountCents,x.shares);
});
