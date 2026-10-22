import {endpoint,parse} from '@/lib/api';
import {mutate} from '@/lib/store';
import {changePolymarketSettings,polySettingsSchema,polySettings} from '@/lib/polymarket';
export const POST=(request:Request)=>endpoint(request,async who=>{
 const input=await parse(request,polySettingsSchema),{room}=await mutate(r=>changePolymarketSettings(r,who,input));return polySettings(room);
});
