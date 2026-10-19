import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rouletteMove} from '../../lib/roulette-store';
import {mutate} from '../../lib/store';
import {db,readRoom,closeDatabase} from '../../lib/db';
import {register,assertRoom} from '../../lib/poker';
import {rouletteState,rouletteTick,roulettePublic} from '../../lib/roulette';
if(!process.env.MONGODB_DB?.startsWith('fakebucks_test_'))throw new Error('Refusing non-test database');
// Separate collection namespace from the poker integration process.
process.env.MONGODB_DB+='_roulette';
const who={id:'r-a',name:'Alice',email:'a@example.test',admin:true};
let started=0;
before(async()=>{await(await db()).dropDatabase();started=Date.now();await mutate(r=>{register(r,who);rouletteState(r,started);});});
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
test('parallel repeated roulette requests debit once and cancelling refunds once',async()=>{const id=randomUUID();await Promise.all(Array.from({length:8},()=>rouletteMove(who,{type:'bet',bet:{kind:'red',amount:1000}},1,id,Date.now())));let r=await readRoom();assert.equal(r.members[0].wallet,99000);assert.equal(roulettePublic(r,who)!.bets.length,1);assertRoom(r);const cancel=randomUUID();await Promise.all(Array.from({length:8},()=>rouletteMove(who,{type:'cancel',betId:id},1,cancel,Date.now())));r=await readRoom();assert.equal(r.members[0].wallet,100000);assertRoom(r);});
test('concurrent replacement and cancel serializes without chip creation',async()=>{const id=randomUUID();await rouletteMove(who,{type:'bet',bet:{kind:'black',amount:1000}},1,id,Date.now());await Promise.allSettled([rouletteMove(who,{type:'change',betId:id,bet:{kind:'red',amount:2000}},1,randomUUID(),Date.now()),rouletteMove(who,{type:'cancel',betId:id},1,randomUUID(),Date.now())]);const r=await readRoom();assert.equal(roulettePublic(r,who)!.bets.length,0);assert.equal(r.members[0].wallet,100000);assertRoom(r);});
test('lock boundary prevents every action and multiple settlement workers settle exactly once',async()=>{const id=randomUUID();await rouletteMove(who,{type:'bet',bet:{kind:'straight',pick:0,amount:100}},1,id,Date.now());const original=Date.now;try{Date.now=()=>started+55000;for(const action of [{type:'bet',bet:{kind:'red',amount:100}},{type:'change',betId:id,bet:{kind:'red',amount:200}},{type:'cancel',betId:id}] as const)await assert.rejects(rouletteMove(who,action,1,randomUUID(),Date.now()));Date.now=()=>started+60000;await Promise.all(Array.from({length:8},()=>mutate(r=>rouletteTick(r,Date.now(),()=>0))));const r=await readRoom();assert.equal(roulettePublic(r,who)!.round,2);assert.equal(roulettePublic(r,who)!.history.length,1);assert.equal(r.members[0].wallet,103500);assertRoom(r);await assert.rejects(rouletteMove(who,{type:'bet',bet:{kind:'red',amount:100}},1,randomUUID(),Date.now()));}finally{Date.now=original;}});
