import {z} from 'zod';
import {endpoint,parse} from '@/lib/api';
import {ensure} from '@/lib/errors';
import {FEATURE_DEFAULTS} from '@/lib/feature-catalog';
import {featureSnapshot,changeFeatures} from '@/lib/feature-flags';
const shape=Object.fromEntries(Object.keys(FEATURE_DEFAULTS).map(key=>[key,z.boolean().optional()]));
const schema=z.object({features:z.object(shape).strict().refine(value=>Object.values(value).some(x=>x!==undefined),'Choose at least one flag.')}).strict();
export const GET=(request:Request)=>endpoint(request,async who=>{ensure(who.admin,'Administrator access required.',403);return featureSnapshot();});
export const PUT=(request:Request)=>endpoint(request,async who=>{ensure(who.admin,'Administrator access required.',403);const {features}=await parse(request,schema,8192);return changeFeatures(who,features);});
