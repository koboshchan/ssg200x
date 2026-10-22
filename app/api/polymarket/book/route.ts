import {endpoint} from '@/lib/api';
import {visit} from '@/lib/store';
import {polyBook} from '@/lib/polymarket-data';
import {polyPortfolio} from '@/lib/polymarket';
export const GET=(request:Request)=>endpoint(request,async who=>{
 polyPortfolio(await visit(who),who);return polyBook(new URL(request.url).searchParams.get('tokenId')??'');
});
