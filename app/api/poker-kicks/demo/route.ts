import {randomUUID} from 'node:crypto';
import {NextResponse} from 'next/server';
import {endpoint,parse} from '@/lib/api';
import {z} from 'zod';
import {mutate} from '@/lib/store';
import {applyPokerKick} from '@/lib/poker-kicks';
import {pokerKickDemoEnabled} from '@/lib/poker-kick-demo';
import {ensure} from '@/lib/errors';
import {freshPublicRoom} from '@/lib/public';
export async function POST(request:Request){
 if(!pokerKickDemoEnabled())return NextResponse.json({error:'Not found.'},{status:404});
 return endpoint(request,async who=>{
  await parse(request,z.object({}).strict());
  const {room}=await mutate(r=>{
   ensure(r.seats.some(s=>s?.userId===who.id),'Join Table 01 before starting the demo.',409);
   const target=r.members.find(m=>m.id==='demo_poker_reaction_bot_1');
   const starter=r.members.find(m=>m.id==='demo_poker_reaction_bot_2');
   ensure(target&&starter,'Demo bots are unavailable.',409);
   applyPokerKick(r,{id:starter.id,name:starter.name,email:'demo@invalid',admin:false},{
    action:'start',tableId:'01',requestId:randomUUID(),requestAt:Date.now(),targetPublicId:target.publicId
   },Date.now());
  });
  return freshPublicRoom(room,who,undefined,'01');
 });
}
