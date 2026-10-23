import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {freshRoom,register,assertRoom} from "./helpers/crypto-room";
import {openPosition,closePosition,pnl,netPnl,liqPrice} from "../lib/finance";
import {adjustPerp} from "../lib/perps-adjust";
import {positionSlice,increasedEntry} from "../runtime/perp-adjustments.mjs";
import {openingFeeCents,closingFeeCents} from "../runtime/perp-fee-policy.mjs";
import {financeSchema} from "../lib/finance-input";
const who={id:"a",name:"A",email:"a@example.test",admin:true};
function setup(side:"long"|"short"="long",mode:"notional"|"profit"="notional"){
 const r=freshRoom();register(r,who);r.perpOpeningFeePpm=300;r.perpClosingFeePpm=mode==="profit"?100000:300;r.perpClosingFeeMode=mode;r.quotes={BTC:{cryptoGeneration:"fixture",micro:100_000_000_000,at:1000}};
 openPosition(r,who,"BTC",side,10000,5,randomUUID(),1000,{takeProfit:side==="long"?140_000_000_000:60_000_000_000,stopLoss:side==="long"?90_000_000_000:110_000_000_000});
 const m=r.members[0],p=m.positions![0];return {r,m,p};
}
function input<B extends {type:"increase";margin:number}|{type:"partial-close";percentBps:number}>(p:{id:string;revision?:number},body:B){return {positionId:p.id,expectedRevision:p.revision??0,requestId:randomUUID(),...body};}
test("increase buys current-price exposure, charges locked opening fee and conserves cash",()=>{
 for(const side of ["long","short"] as const){const {r,m,p}=setup(side),old={...p},wallet=m.wallet,house=r.house??0;r.quotes!.BTC!.micro=side==="long"?105_000_000_000:95_000_000_000;
 const mark=r.quotes!.BTC!.micro,fee=openingFeeCents(5000,5,300),added=5000-fee,expected=increasedEntry(old,added,mark);r.perpOpeningFeePpm=0;
 adjustPerp(r,who,input(p,{type:"increase",margin:5000}),1000);
 assert.equal(p.margin,old.margin+added);assert.equal(p.entry,expected);assert.equal(p.leverage,old.leverage);assert.equal(p.openingFee,old.openingFee!+fee);assert.equal(p.postedMargin!,(p.collateral??0)+p.openingFee!);assert.equal(m.wallet,wallet-5000);assert.equal(r.house,house+fee);assert.equal(p.takeProfit,old.takeProfit);assert.equal(p.stopLoss,old.stopLoss);assert.equal(p.revision,1);assert.notEqual(liqPrice(p),liqPrice(old));assertRoom(r);
 }});
test("entry rounding is conservative for cheap assets and exact BigInt harmonic bounds",()=>{
 for(const side of ["long","short"] as const)for(let entry=1;entry<300;entry+=7){const p={margin:100000000,entry,side};const added=137,mark=entry+3,actual=increasedEntry(p,added,mark),n=BigInt(p.margin+added)*BigInt(entry)*BigInt(mark),d=BigInt(p.margin)*BigInt(mark)+BigInt(added)*BigInt(entry);
 if(side==="long"){assert.ok(BigInt(actual)*d>=n);assert.ok(BigInt(actual-1)*d<n);}else{assert.ok(BigInt(actual)*d<=n);assert.ok(BigInt(actual+1)*d>n);}
 }});
test("10% and 50% partial close conserve every basis, preserve triggers and match display fee",()=>{
 for(const mode of ["notional","profit"] as const)for(const side of ["long","short"] as const)for(const percentBps of [1000,5000,9999]){
 const {r,m,p}=setup(side,mode),old={...p},wallet=m.wallet;r.quotes!.BTC!.micro=side==="long"?105_000_000_000:95_000_000_000;const mark=r.quotes!.BTC!.micro,{slice,remainder}=positionSlice(p,percentBps),expectedFee=closingFeeCents(slice,mark,pnl(slice,mark));
 adjustPerp(r,who,input(p,{type:"partial-close",percentBps}),1000);
 const rest=m.positions![0],closed=m.closedPositions![0];assert.deepEqual(rest,remainder);assert.notEqual(closed.id,old.id);assert.equal(closed.closingFee,expectedFee);assert.equal(m.wallet-wallet,(slice.collateral??slice.margin)+pnl(slice,mark)-expectedFee);assert.equal(closed.realizedPnl,netPnl(slice,mark));
 for(const key of ["margin","postedMargin","collateral","openingFee"] as const)assert.equal((rest[key]??0)+(slice[key]??0),old[key]??0);
 assert.equal(rest.entry,old.entry);assert.equal(rest.leverage,old.leverage);assert.equal(rest.takeProfit,old.takeProfit);assert.equal(rest.stopLoss,old.stopLoss);assert.equal(rest.revision,1);assertRoom(r);
 }});
test("100% uses existing full close fee, leaves no dust, and cannot execute twice",()=>{
 const {r,m,p}=setup(),expected=structuredClone(r);closePosition(expected,who,p.id,1000);const order=input(p,{type:"partial-close",percentBps:10000});adjustPerp(r,who,order,1000);assert.equal(m.positions!.length,0);assert.deepEqual(m.closedPositions,expected.members[0].closedPositions);assert.equal(m.wallet,expected.members[0].wallet);assert.throws(()=>adjustPerp(r,who,order,1000),/not found/i);assertRoom(r);
});
test("stale, foreign, liquidation, invalid and changed positions reject without mutation",()=>{
 for(const mode of ["stale","foreign","liquidation","revision","wallet","limit","dust","zero","over","fraction"]){const {r,p}=setup();const order=input(p,{type:"increase",margin:1000});let owner=who;
 if(mode==="stale")r.quotes!.BTC!.at=-20000;if(mode==="foreign")owner={...who,id:"b"};if(mode==="liquidation")r.quotes!.BTC!.micro=1;if(mode==="revision")order.expectedRevision=1;if(mode==="wallet")order.margin=r.members[0].wallet+1;if(mode==="limit")r.limits={maxTrade:1,maxLeverage:200};
 const body=mode==="dust"?input(p,{type:"partial-close",percentBps:1}):["zero","over","fraction"].includes(mode)?input(p,{type:"partial-close",percentBps:mode==="zero"?0:mode==="over"?10001:12.5}):order;
 const before=structuredClone(r);assert.throws(()=>adjustPerp(r,owner,body,1000),mode);assert.deepEqual(r,before,mode);
 }});
test("splitting cannot erase sub-cent closing fees; unique history and basis conservation",()=>{
 for(const mode of ["profit","notional"] as const){const {r,m,p}=setup("long",mode),old={...p};r.quotes!.BTC!.micro=105_000_000_000;let totalFees=0,closedMargin=0;
 for(let i=0;i<30;i++){const current=m.positions![0];adjustPerp(r,who,input(current,{type:"partial-close",percentBps:1000}),1000);totalFees+=m.closedPositions![0].closingFee!;closedMargin+=m.closedPositions![0].margin;assertRoom(r);}
 closePosition(r,who,p.id,1000);totalFees+=m.closedPositions![0].closingFee!;closedMargin+=m.closedPositions![0].margin;
 assert.equal(closedMargin,old.margin);assert.equal(new Set(m.closedPositions!.map(p=>p.id)).size,31);assert.equal(m.closedPositions!.reduce((n,p)=>n+(p.openingFee??0),0),old.openingFee);assert.equal(m.closedPositions!.reduce((n,p)=>n+(p.postedMargin??0),0),old.postedMargin);assert.ok(totalFees>=closingFeeCents(old,105_000_000_000,pnl(old,105_000_000_000)));assertRoom(r);
 }});
test("legacy no-fee contract remains no-fee after add and split",()=>{
 const {r,m,p}=setup();r.house=(r.house??0)-(p.openingFee??0);delete p.collateral;delete p.postedMargin;delete p.openingFeePpm;delete p.closingFeePpm;delete p.openingFee;p.margin=10000;const before=m.wallet;
 adjustPerp(r,who,input(p,{type:"increase",margin:1000}),1000);assert.equal(p.margin,11000);assert.equal(p.openingFee,0);assert.equal(m.wallet,before-1000);assert.equal(p.collateral,undefined);
 adjustPerp(r,who,input(p,{type:"partial-close",percentBps:5000}),1000);assert.equal(m.closedPositions![0].closingFee,0);assertRoom(r);
});
test("strict bounded schema prohibits client price/leverage/user fields",()=>{
 const base={...input({id:randomUUID()},{type:"partial-close",percentBps:1000}),requestAt:1000};assert.ok(financeSchema.safeParse(base).success);
 for(const patch of [{percentBps:0},{percentBps:10001},{percentBps:1.5},{expectedRevision:-1},{mark:1},{leverage:1},{userId:"other"}])assert.equal(financeSchema.safeParse({...base,...patch}).success,false);
});
test("reached triggers and inherited liquidation override reject unsafe increases",()=>{
 for(const trigger of ["takeProfit","stopLoss","liquidationOverride"] as const){const {r,p}=setup();
 if(trigger==="takeProfit")r.quotes!.BTC!.micro=p.takeProfit!;else if(trigger==="stopLoss")r.quotes!.BTC!.micro=p.stopLoss!;else p.liquidationOverride=r.quotes!.BTC!.micro;
 const before=structuredClone(r);assert.throws(()=>adjustPerp(r,who,input(p,{type:"increase",margin:1000}),1000));assert.deepEqual(r,before);
 }
});
test("large integer allocations and many splits conserve posted collateral plus fee",()=>{
 for(const margin of [1,2,99,100,9985,99999999,100000000])for(const fee of [0,1,37,19999])for(const bps of [1,99,1000,3333,5000,9999,10000]){
 const p={id:randomUUID(),symbol:"BTC",side:"long" as const,leverage:200,entry:1,opened:0,margin,collateral:margin,postedMargin:margin+fee,openingFee:fee};
 if(BigInt(margin)*BigInt(bps)<10000n){assert.throws(()=>positionSlice(p,bps));continue;}
 const {slice,remainder}=positionSlice(p,bps);
 for(const key of ["margin","collateral","postedMargin","openingFee"] as const)assert.equal(slice[key]!+remainder[key]!,p[key]);
 assert.equal(slice.postedMargin!,slice.collateral!+slice.openingFee!);assert.equal(remainder.postedMargin!,remainder.collateral!+remainder.openingFee!);assert.ok(slice.openingFee!>=0);assert.ok(remainder.openingFee!>=0);
 }
});
