import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db,readRoom,rooms,closeDatabase} from '../../lib/db';
import {freshRoom,register,assertRoom} from '../../lib/poker';
import {pokerKick,move} from '../../lib/store';
import {applyPokerTableAction} from '../../lib/poker-tables';
if(!process.env.MONGODB_DB?.startsWith('fakebucks_test_'))throw Error('Isolated test DB required');
process.env.MONGODB_DB+='_kickvotes';
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
const who=(i:number)=>({id:'cas-kick-'+i,name:'CAS '+i,email:'qa@invalid',admin:false});
async function setup(){
 const r=freshRoom();for(let i=0;i<5;i++)register(r,who(i));
 for(let i=0;i<4;i++)applyPokerTableAction(r,'01',who(i),{type:'join',seat:i,buyIn:20000},0,null,Date.now());
 await(await rooms()).replaceOne({_id:'main'},r,{upsert:true});return r;
}
test('CAS competing starts allow exactly one active vote and durable global throttle',async()=>{
 const r=await setup();const targetPublicId=r.members[3].publicId;
 const results=await Promise.allSettled([0,1].map(i=>pokerKick(who(i),{action:'start',tableId:'01',targetPublicId,requestAt:Date.now(),requestId:randomUUID()})));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.filter(x=>x.status==='rejected').length,1);
 const saved=await readRoom(),vote=saved.pokerKickVotes!['01']!;
 assert.equal(vote.status,'active');assert.equal(vote.yesUserIds.length,1);
 await closeDatabase();const reopened=await readRoom();
 assert.deepEqual(reopened.pokerKickVotes,saved.pokerKickVotes);assert.deepEqual(reopened.pokerKickCooldowns,saved.pokerKickCooldowns);assertRoom(reopened);
});
test('concurrent unanimous yes and transport retries perform only one cashout',async()=>{
 const r=await setup();await pokerKick(who(0),{action:'start',tableId:'01',targetPublicId:r.members[3].publicId,requestAt:Date.now(),requestId:randomUUID()});
 const voteId=(await readRoom()).pokerKickVotes!['01']!.id;
 const requests=[1,2].map(()=>({action:'vote' as const,tableId:'01' as const,voteId,yes:true,requestAt:Date.now(),requestId:randomUUID()}));
 await Promise.all(requests.map((request,j)=>pokerKick(who(j+1),request)));
 await Promise.all(requests.map((request,j)=>pokerKick(who(j+1),request)));
 const saved=await readRoom();assert.equal(saved.pokerKickVotes!['01']!.status,'passed');assert.equal(saved.members[3].wallet,100000);assert.equal(saved.seats[3],null);assertRoom(saved);
 assert.equal(await(await db()).collection('audit').countDocuments({what:'poker.kick',target:who(3).id}),1);
});
test('concurrent duplicate admin kick cannot credit twice; membership mutation cancels vote in same CAS',async()=>{
 const r=await setup();await pokerKick(who(0),{action:'start',tableId:'01',targetPublicId:r.members[3].publicId,requestAt:Date.now(),requestId:randomUUID()});
 await move(who(2),{type:'leave'},randomUUID(),0,null,Date.now(),'01');
 assert.equal((await readRoom()).pokerKickVotes!['01']!.status,'cancelled');
 const request={action:'admin-kick' as const,tableId:'01' as const,targetPublicId:r.members[3].publicId,requestAt:Date.now(),requestId:randomUUID()};
 await Promise.all(Array.from({length:6},()=>pokerKick({...who(4),admin:true},request)));
 const saved=await readRoom();assert.equal(saved.members[3].wallet,100000);assert.equal(saved.seats[3],null);assertRoom(saved);
});
