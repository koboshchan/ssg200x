import {endpoint,parse} from '@/lib/api';
import {pokerKick} from '@/lib/store';
import {pokerKickSchema} from '@/lib/poker-kicks';
import {freshPublicRoom} from '@/lib/public';
export async function POST(request:Request){return endpoint(request,async who=>{
 const body=await parse(request,pokerKickSchema);
 return freshPublicRoom(await pokerKick(who,body),who,undefined,body.tableId);
});}
