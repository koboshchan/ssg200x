import {endpoint} from '@/lib/api';
import {visit} from '@/lib/store';
import {polyMarket} from '@/lib/polymarket-data';
import {polyPortfolio} from '@/lib/polymarket';
export const GET=(request:Request)=>endpoint(request,async who=>{
 const portfolio=polyPortfolio(await visit(who),who),market=await polyMarket(new URL(request.url).searchParams.get('id')??'');
 return{market,...portfolio,positions:portfolio.positions.filter(p=>p.marketId===market.id)};
});
