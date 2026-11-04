import "./css-stub";
import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Blackjack from '../app/blackjack-client';
import type {PublicRoom} from '../lib/public';
type H={cards:string[];bet:number;handName?:string|null;result?:string};
function html(hands:H[],dealer:string[]=['Kh','7d'],dealerHandName:string|null|undefined=undefined,houseEdgeBps?:number){
 const t:Record<string,unknown>={id:'lounge',seats:[{name:'Ann',publicId:'a',isYou:true,bet:100,hands}],dealer:{cards:dealer},phase:'settled',round:1,deadline:null,turn:null,minBet:100,maxBet:100000};
 if(dealerHandName!==undefined)t.dealerHandName=dealerHandName;
 const room={serverNow:0,...(houseEdgeBps!==undefined?{casinoLimits:{houseEdgeBps}}:{}),blackjack:{tables:[t]}} as unknown as PublicRoom;
 return renderToStaticMarkup(createElement(Blackjack,{room,busy:false,post:async()=>{}}));
}
test('rules explain Black 78 as the only special, plus blackjack and Charlie',()=>{
 const h=html([]);
 assert.ok(h.includes('Black 78 is the only special hand'));
 assert.ok(h.includes('beats blackjack'));assert.ok(h.includes('two Black 78s push'));assert.ok(h.includes('Five-card Charlie'));
 assert.ok(!/91|9 \+ ace|9A|9 and an ace/i.test(h));
 assert.ok(!/>\s*78\s*>|78 &gt;/.test(h.replace(/Black 78/g,'')));
 assert.equal((h.replace(/Black 78/g,'').match(/78/g)||[]).length,0);
});
test('non-black 78 and 9+Ace render as ordinary hands (server gives no label)',()=>{
 const h=html([{cards:['7h','8d'],bet:100},{cards:['9s','Ah'],bet:100}]);
 assert.ok(h.includes('15 · '));assert.ok(h.includes('20 · '));
 assert.ok(!h.includes(' · Black 78')&&!h.includes(' · 78')&&!h.includes(' · 91'));
});
test('initial special labels render from server fields',()=>{
 for(const n of ['Black 78','Blackjack']){
  const h=html([{cards:['7s','8c'],bet:100,handName:n}]);
  assert.ok(h.includes(' · '+n));
 }
 assert.ok(!html([{cards:['7s','8c'],bet:100,handName:null}]).includes('Charlie</small>'));
});
test('Charlie label renders for player and split hands',()=>{
 const h=html([{cards:['2s','3h','4d','5c','2d'],bet:100,handName:'Charlie'},{cards:['2s','3h','4d','5c','2h'],bet:100,handName:'Charlie',result:'win'}]);
 assert.equal(h.split(' · Charlie').length-1,2);
});
test('split hand without server name shows no special label (client does not infer)',()=>{
 const h=html([{cards:['As','Kc'],bet:100,handName:null},{cards:['7s','7c'],bet:100}]);
 assert.ok(!h.includes('Blackjack</small>')&&!h.includes(' · Blackjack'));
 assert.ok(!h.includes(' · 78'));
});
test('hidden dealer hand name absent; revealed shown',()=>{
 const hid=html([{cards:['7s','8c'],bet:100}],['Ah','?'],null);
 assert.ok(!hid.includes('Dealer · 11 · '));
 assert.ok(!/Dealer[^<]*· (Blackjack|Black 78|91|78|Charlie)/.test(hid));
 assert.ok(!html([{cards:['7s','8c'],bet:100}],['Ah','?']).includes('Blackjack</small>'));
 assert.ok(html([{cards:['7s','8c'],bet:100}],['Ah','Kd'],'Blackjack').includes('Dealer · 21 · Blackjack'));
});

test('rules disclose signed gross payout scale without a calibrated blackjack RTP claim',()=>{
 for(const [bps,scale,label] of [[-1000,'110.00%','player bonus 10.00%'],[0,'100.00%','0.00% house edge'],[200,'98.00%','2.00% house edge']] as const){
  const h=html([],undefined,undefined,bps);
  assert.ok(h.includes('gross returns are multiplied by '+scale));
  assert.ok(h.includes(label));assert.ok(h.includes('does not guarantee a particular RTP'));
  assert.ok(h.includes('base payout of 3:2'));assert.ok(h.includes('base payout of 1:1'));
 }
});
