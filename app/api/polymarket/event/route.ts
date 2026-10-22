import {endpoint} from '@/lib/api';
import {visit} from '@/lib/store';
import {polyEvent} from '@/lib/polymarket-data';
import {polyPortfolio} from '@/lib/polymarket';
export const GET=(request:Request)=>endpoint(request,async who=>{
 const portfolio=polyPortfolio(await visit(who),who);return{event:await polyEvent(new URL(request.url).searchParams.get('id')??''),...portfolio};
});
