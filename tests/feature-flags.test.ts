import test from 'node:test';
import assert from 'node:assert/strict';
import {FEATURE_DEFAULTS,resolveFeatures} from '../lib/feature-catalog';
import {enforceFeatureRequest} from '../lib/feature-flags';
import {freshRoom} from '../lib/poker';
import {replaceForexPairs,validateForexPairs} from '../lib/admin-symbols';
const off=resolveFeatures(Object.fromEntries(Object.keys(FEATURE_DEFAULTS).map(k=>[k,false])),{});
const deps={snapshot:async()=>({features:off,configured:off,revision:0,forcedOff:[]}),room:async()=>freshRoom()};
test('defaults and strict force-off override',()=>{assert.equal(FEATURE_DEFAULTS.stocks,false);assert.equal(FEATURE_DEFAULTS.forex,false);assert.equal(FEATURE_DEFAULTS.poker,true);assert.equal(resolveFeatures({stocks:true,poker:true},{SSG_FEATURES_FORCE_OFF:'stocks, poker,unknown'}).stocks,false);});
test('disabled entries reject without admin bypass',async()=>{
 for(const [path,input] of [['action',{type:'join'}],['action',{type:'ready'}],['blackjack',{type:'bet'}],['roulette',{type:'bet'}],['doudizhu',{type:'create'}],['games',{type:'start',game:'chicken'}],['transfers',{action:'send'}],['airdrops',{action:'confirm'}],['check-in',{type:'claim'}],['polymarket/trade',{action:'buy'}],['finance',{type:'open',symbol:'BTC'}],['finance',{type:'spot',side:'buy',symbol:'AAPL'}]] as const){await assert.rejects(enforceFeatureRequest('/api/'+path,'POST',input,'u',deps),/Temporarily disabled/);}
});
test('disabled markets preserve sell close and game exits',async()=>{
 for(const [path,input] of [['action',{type:'leave'}],['action',{type:'call'}],['blackjack',{type:'stand'}],['roulette',{type:'cancel'}],['doudizhu',{type:'play'}],['games',{type:'cashout'}],['transfers',{action:'cancel'}],['finance',{type:'close'}],['finance',{type:'close-all'}],['finance',{type:'spot',side:'sell'}],['polymarket/trade',{action:'sell'}]] as const)await enforceFeatureRequest('/api/'+path,'POST',input,'u',deps);
});
test('individual mini-game gate works while parent enabled',async()=>{const f={...FEATURE_DEFAULTS,chicken:false};await assert.rejects(enforceFeatureRequest('/api/games','POST',{type:'start',game:'chicken'},'u',{...deps,snapshot:async()=>({features:f,configured:f,revision:0,forcedOff:[]})}),/Temporarily disabled/);});
const admin={id:'a',name:'Admin',email:'a@example.com',admin:true};
test('FX list swaps atomically with one revision and audit',()=>{const r=freshRoom();replaceForexPairs(r,admin,['EUR/USD','USD/JPY'],0,true);assert.deepEqual(r.marketSymbols?.forex,['EUR/USD','USD/JPY']);assert.equal(r.marketSymbols?.revision,1);assert.equal(r.auditPending?.length,1);assert.throws(()=>replaceForexPairs(r,admin,['EUR/USD'],0,true),/changed/);});
test('FX removal preserves open claims',()=>{const r=freshRoom();replaceForexPairs(r,admin,['EUR/USD'],0,true);r.members.push({id:'u',holdings:[{symbol:'EUR/USD',units:100}]} as any);assert.throws(()=>replaceForexPairs(r,admin,[],1,true),/open claims/);assert.deepEqual(r.marketSymbols?.forex,['EUR/USD']);});
test('FX metadata validates list in one provider request',async()=>{let calls=0;await validateForexPairs(['EUR/USD','USD/JPY'],async()=>{calls++;return new Response(JSON.stringify({instruments:[{name:'EUR_USD',type:'CURRENCY'},{name:'USD_JPY',type:'CURRENCY'}]}));},{OANDA_API_TOKEN:'test',OANDA_ACCOUNT_ID:'test'});assert.equal(calls,1);});
import {bindRoomFeatures} from '../lib/feature-context';
import {settleAdvancements} from '../lib/advancements';
test('advancements disabled at server settlement, without removing old rewards',()=>{const r=freshRoom();bindRoomFeatures(r,off);const m={id:'u',wallet:100,advancements:{streak:4,lastRound:0,unlocked:{}}} as any;settleAdvancements(m,[{id:'w',userId:'u',bet:{kind:'red',amount:100}}],2,1,100,r);assert.equal(m.wallet,100);assert.equal(m.advancements.streak,4);});
test('single-tab enforcement defaults on and uses strict admin feature values',()=>{
 assert.equal(FEATURE_DEFAULTS.singleTab,true);
 assert.equal(resolveFeatures({},{}).singleTab,true);
 assert.equal(resolveFeatures({singleTab:false},{}).singleTab,false);
 assert.equal(resolveFeatures({singleTab:true},{}).singleTab,true);
 assert.equal(resolveFeatures({singleTab:'false'} as any,{}).singleTab,true);
 assert.equal(resolveFeatures({singleTab:true},{SSG_FEATURES_FORCE_OFF:'singleTab'}).singleTab,false);
});
