import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openingFeeCents,feeCents} from '../lib/perp-fees';
import {freshRoom,register,assertRoom} from './helpers/crypto-room';
import {setPerpFees} from '../lib/admin';
import {openPosition,closePosition,netPnl} from '../lib/finance';

test('opening solves fee on final executed notional instead of charging the gross posted basis',()=>{
 assert.equal(openingFeeCents(10000,200,500),909);
 assert.equal(openingFeeCents(11000,200,500),1000);
 assert.equal(openingFeeCents(10000,125,889),1000);
 assert.equal(openingFeeCents(10000,200,0),0);
 assert.equal(openingFeeCents(10000,200,1000),1667);
 // Half-cent fee ties round up once; collateral receives the remainder.
 assert.equal(openingFeeCents(1002,200,1000),167);
 for(const args of [[-1,2,300],[100,0,300],[100,201,300],[100,2,-1],[100,2,1001],[100.5,2,300],[100,2,NaN]]){
  assert.throws(()=>openingFeeCents(...args as [number,number,number]));
 }
});

test('rational cent rounding conserves posted margin and stays within disclosed executed-notional tolerance',()=>{
 for(const posted of [100,101,999,1002,10000,11000,99999999,100000000])for(const leverage of [1,2,5,125,200])for(const ppm of [0,1,300,500,889,1000]){
  const fee=openingFeeCents(posted,leverage,ppm),net=posted-fee;
  const k=BigInt(leverage*ppm),den=1000000n+k,numerator=BigInt(posted)*k;
  assert.equal(fee,Number((numerator+den/2n)/den));
  assert.equal(net+fee,posted);
  // |F - net*leverage*rate| <= 0.5cent*(1+leverage*rate), exactly.
  const error=BigInt(fee)*1000000n-BigInt(net)*k;
  assert.ok(2n*(error<0n?-error:error)<=den);
 }
});

for(const side of ['long','short'] as const)test(`self-consistent ${side} sizing survives restart and settles fees from position proceeds`,()=>{
 const who={id:'solved',name:'Solved',email:'s@test',admin:true},r=freshRoom();register(r,who);
 r.quotes={BTC:{cryptoGeneration:"fixture",micro:100000000,at:1000}};setPerpFees(r,who,0.05,0.03);
 openPosition(r,who,'BTC',side,10000,200,'p',1000);
 const p=r.members[0].positions![0];
 assert.equal(p.openingFee,909);assert.equal(p.margin,9091);assert.equal(p.collateral,9091);
 assert.equal(p.margin*p.leverage,1818200);
 assert.equal(p.postedMargin,10000);assert.equal(r.members[0].wallet,90000);
 assert.equal(p.openingFee,feeCents(p.margin,p.leverage,p.entry,p.entry,500));
 assert.equal(netPnl(p,p.entry),-1454);
 const restored=JSON.parse(JSON.stringify(r));setPerpFees(restored,who,0.1,0.1);
 closePosition(restored,who,'p',1000);const c=restored.members[0].closedPositions![0];
 assert.equal(c.openingFee,909);assert.equal(c.closingFee,545);assert.equal(c.realizedPnl,-1454);
 assert.equal(restored.members[0].wallet,98546);assertRoom(restored);
});
