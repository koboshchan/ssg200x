import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {freshRoom,register} from '../lib/poker';
import {freshPokerTable} from '../lib/poker-tables';
import {publicRoom} from '../lib/public';
import {leaderboardSnapshot} from '../lib/leaderboard';
import {pnl,liqPrice,netPnl,equity} from '../lib/finance';
import type {Room,Seat} from '../lib/types';
// @ts-expect-error plain JS entry used by the standalone server
import {marketPayload} from '../runtime/market-payload.mjs';
const who={id:'private-alice-id',name:'Alice',email:'private-alice-email@test',admin:false};
const other={id:'private-bob-id',name:'Bob',email:'private-bob-email@test',admin:false};
function fixture(){const r=freshRoom();register(r,who);register(r,other);return r;}
function projected(r:Room):Room{
 const source=readFileSync('lib/leaderboard-store.ts','utf8');
 const body=/projection:\{([\s\S]*?)\}/.exec(source)![1];
 return Object.fromEntries([...body.matchAll(/(\w+)\s*:\s*1\b/g)].map(([,key])=>[key,structuredClone((r as unknown as Record<string,unknown>)[key])])) as unknown as Room;
}
function assertParity(r:Room){
 const before=structuredClone(r),full=publicRoom(structuredClone(r),who),wire=marketPayload(r,who.id,123);
 const board=leaderboardSnapshot(projected(r),123);
 assert.equal(wire.netWorth,full.leaderboard.find(x=>x.name==='Alice')!.netWorth);
 assert.deepEqual(wire.leaderboard,full.leaderboard);
 assert.deepEqual(board.rows.map(({name,netWorth})=>({name,netWorth})),full.leaderboard.map(({name,netWorth})=>({name,netWorth})));
 assert.deepEqual(r,before,'serializers must never mutate ledger inputs');
 return {full,wire,board};
}
test('non-default poker table stacks and committed chips survive all summary surfaces',()=>{
 for(const id of ['02','03'] as const)for(const street of ['waiting','flop','showdown'] as const){
  const r=fixture(),t=freshPokerTable();t.street=street;
  t.seats[0]={userId:who.id,stack:7000,committed:300,bet:100,hole:['As','Ah'],folded:false,inHand:true,actedAt:null,sitOut:false,leaveAfter:false,seen:0} as Seat;
  r.pokerTables={[id]:t};r.members[0].wallet-=7300;
  const {wire}=assertParity(r);assert.equal(wire.netWorth,100000);
 }
});
test('DDZ escrow stays in anonymous projected leaderboard as well as full and socket',()=>{
 const r=fixture();r.members[0].wallet-=15000;
 r.doudizhu=[{players:[{userId:who.id,escrow:15000},{userId:other.id,escrow:0}]}] as unknown as NonNullable<Room['doudizhu']>;
 const {wire}=assertParity(r);assert.equal(wire.netWorth,100000);
});
for(const symbol of ['USD/JPY','AUD/JPY','EUR/USD'])test(symbol+' native spot uses USD valuation and shared FX position math',()=>{
 const r=fixture(),mark=symbol==='USD/JPY'?165_000_000:symbol==='AUD/JPY'?110_000_000:1_200_000;
 const usdMicro=symbol==='USD/JPY'?1_000_000:symbol==='AUD/JPY'?687500:mark;
 r.quotes={[symbol]:{micro:mark,at:0}};
 r.forexQuotes={[symbol]:{micro:mark,at:0,source:'oanda',quoteCurrency:symbol.slice(4),usdMicro}};
 const m=r.members[0];m.holdings=[{symbol,units:100_000_000,cost:10000}];
 m.positions=[{id:'private-fx-position',symbol,side:'long',margin:10000,collateral:10000,postedMargin:10000,leverage:10,entry:symbol==='USD/JPY'?150_000_000:symbol==='AUD/JPY'?100_000_000:1_100_000,opened:0,fx:{units:100000,quoteUsd:symbol==='AUD/JPY'?1/160:1},closingFeePpm:100,openingFeePpm:0,openingFee:0}];
 const {full,wire}=assertParity(r),p=m.positions[0];
 assert.equal(wire.holdings[0].value,Number(BigInt(m.holdings[0].units)*BigInt(usdMicro)/1_000_000_000_000n));
 assert.deepEqual(wire.holdings,full.holdings);
 assert.equal(wire.positions[0].pnl,netPnl(p,mark));
 assert.equal(wire.positions[0].equity,equity(p,mark));
 assert.equal(wire.positions[0].liquidation,liqPrice(p));
 assert.equal(full.positions[0].pnl,netPnl(p,mark));
 if(symbol==='USD/JPY')assert.equal(pnl(p,mark),9090);
});
test('privacy filters standings before ranking and no private ledger fields leak',()=>{
 const r=fixture();r.members[1].settings={triggerInputMode:'price',hideFromLeaderboard:true};
 r.members[1].positions=[{id:'other-secret-position',symbol:'BTC',margin:100,leverage:1,entry:100,side:'long',opened:0}];
 const {wire,board}=assertParity(r);assert.equal(wire.leaderboard.length,1);assert.equal(board.rows[0].rank,1);
 for(const secret of [who.id,who.email,other.id,other.email,'other-secret-position','pokerTables','doudizhu','receipts'])assert.equal(JSON.stringify(wire).includes(secret),false,secret);
 for(const secret of [who.id,who.email,other.id,other.email,'positions','wallet','holdings'])assert.equal(JSON.stringify(board).includes(secret),false,secret);
 assert.deepEqual(marketPayload(r,other.id).positions.map((p:{id:string})=>p.id),['other-secret-position']);
 assert.equal(marketPayload(r,'unknown'),null);
});
test('isolated inverse-USD position socket calculation matches full snapshot independently of projection',()=>{
 const r=fixture();r.quotes={'USD/JPY':{micro:165000000,at:0}};
 r.members[0].positions=[{id:'fx-only',symbol:'USD/JPY',side:'long',margin:10000,leverage:10,entry:150000000,opened:0,fx:{units:100000,quoteUsd:1}}];
 const wire=marketPayload(r,who.id),full=publicRoom(structuredClone(r),who);
 assert.equal(wire.positions[0].equity,full.positions[0].equity);
 assert.equal(wire.positions[0].liquidation,full.positions[0].liquidation);
});
test('FX long/short fee modes and collateral variants match full snapshot without writes',()=>{
 for(const symbol of ['USD/JPY','AUD/JPY','EUR/USD'])for(const side of ['long','short'] as const)for(const closingFeeMode of ['notional','profit'] as const)for(const legacy of [false,true]){
  const r=fixture(),entry=symbol==='USD/JPY'?150000000:symbol==='AUD/JPY'?100000000:1100000;
  r.quotes={[symbol]:{micro:Math.round(entry*1.03),at:0}};
  r.members[0].positions=[{id:'fx-matrix',symbol,side,margin:10000,...(!legacy?{collateral:10000,postedMargin:10005}:{}),leverage:10,entry,opened:0,fx:{units:100000,quoteUsd:symbol==='AUD/JPY'?1/160:1},closingFeeMode,closingFeePpm:closingFeeMode==='profit'?200000:100,openingFee:5,closingFeeRoundUp:true}];
  const before=structuredClone(r),full=publicRoom(structuredClone(r),who),wire=marketPayload(r,who.id);
  for(const field of ['pnl','liquidation','equity'])assert.equal(wire.positions[0][field],(full.positions[0] as unknown as Record<string,unknown>)[field],symbol+' '+side+' '+closingFeeMode+' '+field);
  assert.deepEqual(r,before);
 }
});
