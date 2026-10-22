import {endpoint,parse} from '@/lib/api';
import {rateLimit} from '@/lib/store';
import {polyTradeSchema} from '@/lib/polymarket';
import {polymarketTrade} from '@/lib/polymarket-store';
export const POST=(request:Request)=>endpoint(request,async who=>{
 await rateLimit('polymarket.trade:'+who.id,40);return polymarketTrade(who,await parse(request,polyTradeSchema));
});
