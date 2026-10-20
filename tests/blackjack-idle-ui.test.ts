import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Blackjack from '../app/blackjack-client';
import type {PublicRoom} from '../lib/public';
function html(now:number,phase='betting',bet=0){
 const room={serverNow:now,blackjack:{tables:[{id:'lounge',seats:[{name:'Idle',publicId:'x',isYou:true,bet,idleDeadline:300000,hands:[]}],dealer:{cards:[]},phase,round:0,deadline:null,turn:null,minBet:100,maxBet:100000}]}} as unknown as PublicRoom;
 return renderToStaticMarkup(createElement(Blackjack,{room,busy:false,post:async()=>{}}));
}
test('actual seat markup only shows idle warning during final 90 seconds of unbet betting phase',()=>{
 assert.ok(!html(209999).includes('Bet within'));
 assert.ok(html(210000).includes('Bet within 90s to keep seat'));
 assert.ok(html(299999).includes('Bet within 1s to keep seat'));
 assert.ok(!html(210000,'playing').includes('Bet within'));
 assert.ok(!html(210000,'settled').includes('Bet within'));
 assert.ok(!html(210000,'betting',100).includes('Bet within'));
});
