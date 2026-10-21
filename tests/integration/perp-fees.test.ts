import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {db,readRoom,closeDatabase} from '../../lib/db';
import {mutate} from '../../lib/store';
import {register,assertRoom} from '../../lib/poker';
import {openPosition,closePosition} from '../../lib/finance';
import {setPerpFee,setPerpFees} from '../../lib/admin';
import {settleTriggers} from '../../lib/position-triggers';
if(!process.env.MONGODB_DB?.startsWith('fakebucks_test_'))throw new Error('Requires isolated test DB');
process.env.MONGODB_DB+='_perp_fees';
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
test('Mongo CAS concurrent opening receipts debit once, persistence locks rate and competing manual/TP settles once',async()=>{
 const who={id:'fee',name:'Fee',email:'fee@test',admin:true},now=Date.now();
 await mutate(r=>{register(r,who);setPerpFees(r,who,0.02,0.07);r.quotes={BTC:{micro:100000000,at:now}};});
 await Promise.all(Array.from({length:5},()=>mutate(r=>{
 if(r.receipts.some(x=>x.id==='open-receipt'))return;
 openPosition(r,who,'BTC','long',10000,5,'p',now,{takeProfit:110000000});r.receipts.push({id:'open-receipt',userId:who.id,at:now});
 })));
 await closeDatabase();let r=await readRoom();assert.equal(r.members[0].wallet,90000);assert.equal(r.members[0].positions!.length,1);assert.equal(r.house,10);assert.equal(r.members[0].positions![0].collateral,9990);assert.equal(r.members[0].positions![0].openingFeePpm,200);assert.equal(r.members[0].positions![0].closingFeePpm,700);assertRoom(r);
 await mutate(r=>{setPerpFee(r,who,0.1);r.quotes!.BTC={micro:110000000,at:now+1};});
 await Promise.all(Array.from({length:5},(_,i)=>mutate(r=>{
 if(i%2===0){if(r.members[0].positions?.some(p=>p.id==='p'))closePosition(r,who,'p',now+1);}else settleTriggers(r,now+1);
 })));
 await closeDatabase();r=await readRoom();assert.equal(r.members[0].closedPositions!.length,1);assert.equal(r.members[0].wallet,104951);assert.equal(r.members[0].closedPositions![0].closingFee,39);assert.equal(r.members[0].closedPositions![0].realizedPnl,4951);assertRoom(r);
 const saved=r.members[0].wallet;await mutate(r=>settleTriggers(r,now+1));assert.equal((await readRoom()).members[0].wallet,saved);
});
