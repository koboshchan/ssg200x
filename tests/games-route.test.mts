import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {freshRoom,register,assertRoom} from '../lib/poker';
import {AppError} from '../lib/errors';
let room=freshRoom();const who={id:'games-route',name:'Games',email:'games@test',admin:false};
mock.module('../lib/api.ts',{namedExports:{endpoint:async(_request:Request,handler:Function)=>{try{return Response.json(await handler(who));}catch(e){return Response.json({error:(e as Error).message},{status:e instanceof AppError?e.status:400});}},parse:async(request:Request,schema:any)=>schema.parse(await request.json())}});
mock.module('../lib/store.ts',{namedExports:{rateLimit:async()=>{},visit:async()=>room,mutate:async(fn:Function)=>{for(let i=0;i<12;i++){const before=room,next=structuredClone(before),result=fn(next);assertRoom(next);await Promise.resolve();if(room.version!==before.version)continue;next.version++;room=next;return {room:next,result};}throw new AppError('Busy',409);}}});
const {POST,GET}=await import('../app/api/games/route');
const request=(body:object)=>new Request('https://games.invalid/api/games',{method:'POST',body:JSON.stringify(body)});
const wager=()=>({type:'start',game:'plinko',amount:500,requestId:randomUUID(),requestAt:Date.now()});
test('Games POST acknowledges the exact committed drop, including concurrent duplicate and lost-reply replay',async()=>{
 room=freshRoom();register(room,who);const inputs=Array.from({length:4},wager);
 const replies=await Promise.all(inputs.flatMap(body=>[POST(request(body)),POST(request(body))]));
 assert.deepEqual(replies.map(r=>r.status),Array(8).fill(200));
 const bodies=await Promise.all(replies.map(r=>r.json()));
 for(let i=0;i<inputs.length;i++)for(const body of bodies.slice(i*2,i*2+2)){
  assert.equal(body.actionGameId,inputs[i].requestId);
  assert.ok(body.games.some((g:any)=>g.id===body.actionGameId&&g.kind==='plinko'));
 }
 const wallet=room.members[0].wallet,serialized=JSON.stringify(room.miniGames);
 // Browser may lose any reply above; replay keeps that original request envelope.
 for(const body of inputs){const replay=await POST(request(body));assert.equal(replay.status,200);assert.equal((await replay.json()).actionGameId,body.requestId);}
 assert.equal(room.members[0].wallet,wallet);assert.equal(JSON.stringify(room.miniGames),serialized);assertRoom(room);
 const changed=await POST(request({...inputs[0],amount:1000}));assert.equal(changed.status,409);
 const snapshot=await GET(new Request('https://games.invalid/api/games'));assert.equal(snapshot.status,200);assert.equal((await snapshot.json()).games.length,4);
});
test('Games rejects unknown fields before any debit and returns safe acknowledgment after result retention',async()=>{
 room=freshRoom();register(room,who);const first=wager();
 assert.equal((await POST(request({...first,guaranteedWin:true}))).status,400);assert.equal(room.members[0].wallet,100000);
 assert.equal((await POST(request(first))).status,200);for(let i=0;i<32;i++)assert.equal((await POST(request(wager()))).status,200);
 const before=room.members[0].wallet;
 const replay=await POST(request(first));assert.equal(replay.status,200);assert.equal((await replay.json()).actionGameId,null);assert.equal(room.members[0].wallet,before);
});
test('Chicken POST atomically charges and attempts lane one; duplicate and lost-reply replay preserve its result',async()=>{
 room=freshRoom();register(room,who);
 const input={...wager(),game:'chicken'};
 const replies=await Promise.all(Array.from({length:8},()=>POST(request(input))));
 assert.deepEqual(replies.map(r=>r.status),Array(8).fill(200));
 for(const reply of replies){
  const body=await reply.json(),g=body.games.find((g:any)=>g.id===input.requestId);
  assert.equal(body.actionGameId,input.requestId);assert.equal(g.steps,1);
  assert.ok(g.status==='active'||g.status==='lost');assert.equal(g.revision,0);
 }
 assert.equal(room.members[0].wallet,99500);assert.equal(room.miniGames!.length,1);
 const saved=JSON.stringify(room.miniGames);
 assert.equal((await POST(request(input))).status,200);
 assert.equal(JSON.stringify(room.miniGames),saved);assert.equal(room.members[0].wallet,99500);assertRoom(room);
});
test('Plinko route risk allowlist rejects before mutation; concurrent risks keep their own tables',async()=>{
 room=freshRoom();register(room,who);
 const before=structuredClone(room);
 for(const risk of ['invalid',null,42,{},'LOW']){
  assert.equal((await POST(request({...wager(),risk}))).status,400);
  assert.deepEqual(room,before);
 }
 const inputs=['low','medium','high'].map(risk=>({...wager(),risk}));
 const replies=await Promise.all(inputs.map(body=>POST(request(body))));
 assert.deepEqual(replies.map(x=>x.status),[200,200,200]);
 for(let i=0;i<3;i++){
  const body=await replies[i].json(),g=body.games.find((g:any)=>g.id===inputs[i].requestId);
  assert.equal(g.risk,inputs[i].risk);assert.equal(g.plinkoTable.length,9);
 }
 const saved=structuredClone(room);
 assert.equal((await POST(request({...inputs[0],risk:'high'}))).status,409);
 assert.deepEqual(room,saved);
 for(const input of [...inputs].reverse())assert.equal((await POST(request(input))).status,200);
 assert.equal(room.members[0].wallet,saved.members[0].wallet);
});
