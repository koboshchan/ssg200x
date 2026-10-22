import {endpoint} from '@/lib/api';
import {visit} from '@/lib/store';
import {polyDiscover} from '@/lib/polymarket-data';
import {polySettings,polyPortfolio} from '@/lib/polymarket';
export const GET=(request:Request)=>endpoint(request,async who=>{
 const r=await visit(who);polyPortfolio(r,who);const p=new URL(request.url).searchParams;
 return{...await polyDiscover(p.get('q')??'',p.get('cursor')??'',p.get('tag')??''),...polySettings(r)};
});
