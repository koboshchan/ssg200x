import {endpoint} from '@/lib/api';
import {visit} from '@/lib/store';
import {polyChart} from '@/lib/polymarket-data';
import {polyPortfolio} from '@/lib/polymarket';
export const GET=(request:Request)=>endpoint(request,async who=>{
 polyPortfolio(await visit(who),who);const p=new URL(request.url).searchParams;return polyChart(p.get('tokenId')??'',p.get('interval')??'1d');
});
