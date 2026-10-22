import test from 'node:test';
import assert from 'node:assert/strict';
import {PLINKO_RISKS,PLINKO_RISK_TABLES,PLINKO_BINOMIAL,isPlinkoRisk} from '../lib/plinko-risk';
test('each risk has symmetric positive integer fractions with exactly 98% binomial RTP',()=>{
 for(const risk of PLINKO_RISKS){
  const table=PLINKO_RISK_TABLES[risk];
  let n=0n,d=1n;
  for(let k=0;k<9;k++){
   const b=table[k];assert.deepEqual(b,table[8-k]);assert.ok(b.numerator>0&&b.denominator>0);
   assert.ok(Number.isSafeInteger(b.numerator)&&Number.isSafeInteger(b.denominator));
   n=n*BigInt(b.denominator)+BigInt(b.numerator)*BigInt(PLINKO_BINOMIAL[k])*d;d*=BigInt(b.denominator);
   assert.equal(b.multiplier,b.numerator/b.denominator);
  }
  assert.equal(n*100n,d*256n*98n);
 }
 const t=PLINKO_RISK_TABLES;
 assert.ok(t.low[0].multiplier<t.medium[0].multiplier&&t.medium[0].multiplier<t.high[0].multiplier);
 assert.ok(t.low[4].multiplier>t.medium[4].multiplier&&t.medium[4].multiplier>t.high[4].multiplier);
 assert.ok(t.low[4].multiplier<1&&t.low[0].multiplier>1&&t.high[0].multiplier>10);
 assert.ok(isPlinkoRisk('low'));assert.ok(!isPlinkoRisk('LOW'));assert.ok(!isPlinkoRisk(null));
});
test('risk variance strictly increases and exact weighted cent-floor loss is in [0,1)',()=>{
 // Rational arithmetic throughout: compare second moments, since means match.
 const moments=PLINKO_RISKS.map(risk=>{
  let n=0n,d=1n;
  for(const [k,b] of PLINKO_RISK_TABLES[risk].entries()){
   const bn=BigInt(b.numerator),bd=BigInt(b.denominator);
   n=n*bd*bd+BigInt(PLINKO_BINOMIAL[k])*bn*bn*d;d*=bd*bd;
  }
  return {n,d};
 });
 for(let i=1;i<moments.length;i++)assert.ok(moments[i].n*moments[i-1].d>moments[i-1].n*moments[i].d);
 for(const risk of PLINKO_RISKS)for(let bet=1n;bet<=10000n;bet++){
  const weightedPaid=PLINKO_RISK_TABLES[risk].reduce((sum,b,k)=>
   sum+BigInt(PLINKO_BINOMIAL[k])*(bet*BigInt(b.numerator)/BigInt(b.denominator)),0n);
  // E[payout]=weightedPaid/256. Strict lower bound .98*B-1.
  assert.ok(weightedPaid*100n<=98n*bet*256n);
  assert.ok(weightedPaid*100n>(98n*bet-100n)*256n);
 }
});
