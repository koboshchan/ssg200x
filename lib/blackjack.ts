import {randomInt} from 'node:crypto';
import {ensure} from './errors';
import type {Room,Identity} from './types';

// Six-deck S17, blackjack 3:2. One split only; split aces receive one card,
// no resplit, no insurance/surrender. Double any initial two cards (including splits).
export type BlackjackHand={cards:string[];bet:number;done:boolean;split:boolean;payout:number;result?:string};
export type BlackjackSeat={userId:string;bet:number;hands:BlackjackHand[];leaveAfter:boolean};
export type BlackjackState={phase:'betting'|'playing'|'settled';seats:(BlackjackSeat|null)[];dealer:string[];shoe:string[];turn:number|null;hand:number;deadline:number|null;round:number;revealed:boolean};
export type BlackjackAction={type:'join';seat:number}|{type:'leave'}|{type:'bet';amount:number}|{type:'hit'|'stand'|'double'|'split'};
type BRoom=Room & {blackjack?:BlackjackState};
const BET_MS=10_000,TURN_MS=30_000,BREAK_MS=5_000;
export function blackjackShoe(rng:(max:number)=>number=randomInt):string[]{
 const cards=Array.from({length:6},()=>[...'shcd'].flatMap(s=>[...'23456789TJQKA'].map(v=>v+s))).flat();
 for(let i=cards.length-1;i>0;i--){const j=rng(i+1);[cards[i],cards[j]]=[cards[j],cards[i]];}return cards;
}
export function blackjackValue(cards:string[]):number{let v=0,a=0;for(const c of cards){if(c[0]==='A'){v+=11;a++;}else v+='TJQK'.includes(c[0])?10:Number(c[0]);}while(v>21&&a-->0)v-=10;return v;}
function state(r:BRoom):BlackjackState{return r.blackjack??= {phase:'betting',seats:Array(6).fill(null),dealer:[],shoe:[],turn:null,hand:0,deadline:null,round:0,revealed:false};}
function member(r:BRoom,id:string){const m=r.members.find(m=>m.id===id);ensure(m,'Unknown member.',403);return m;}
function draw(b:BlackjackState){ensure(b.shoe.length,'Blackjack shoe exhausted.',500);return b.shoe.pop()!;}
const natural=(h:BlackjackHand)=>!h.split&&h.cards.length===2&&blackjackValue(h.cards)===21;
export function blackjackAssets(r:Room):number{const b=(r as BRoom).blackjack;if(!b)return 0;return b.seats.reduce((n,s)=>n+(s?(b.phase==='betting'?s.bet:b.phase==='playing'?s.hands.reduce((v,h)=>v+h.bet,0):0):0),0);}
function settle(r:BRoom,b:BlackjackState,now:number){
 b.revealed=true;
 const dealerNatural=b.dealer.length===2&&blackjackValue(b.dealer)===21;
 const needDealer=b.seats.some(s=>s?.hands.some(h=>blackjackValue(h.cards)<=21&&!natural(h)));
 if(!dealerNatural&&needDealer)while(blackjackValue(b.dealer)<17)b.dealer.push(draw(b));
 const dv=blackjackValue(b.dealer);
 for(const s of b.seats){if(!s)continue;for(const h of s.hands){const v=blackjackValue(h.cards);let p=0;
 if(v>21)h.result='bust';else if(dealerNatural){p=natural(h)?h.bet:0;h.result=p?'push':'lose';}
 else if(natural(h)){p=h.bet*5/2;h.result='blackjack';}
 else if(dv>21||v>dv){p=h.bet*2;h.result='win';}else if(v===dv){p=h.bet;h.result='push';}else h.result='lose';
 member(r,s.userId).wallet+=p;r.house=(r.house??0)+h.bet-p;h.payout=p;h.done=true;
 }}
 b.phase='settled';b.turn=null;b.deadline=now+BREAK_MS;
}
function advance(r:BRoom,b:BlackjackState,now:number){for(let i=0;i<b.seats.length;i++){const s=b.seats[i];if(!s)continue;const j=s.hands.findIndex(h=>!h.done);if(j!==-1){b.turn=i;b.hand=j;b.deadline=now+TURN_MS;return;}}settle(r,b,now);}
function deal(r:BRoom,b:BlackjackState,now:number){
 // At most 12 player hands plus dealer; reserve well beyond the maximum reachable draws.
 if(b.shoe.length<156)b.shoe=blackjackShoe();
 b.phase='playing';b.round++;b.revealed=false;b.dealer=[];
 for(const s of b.seats)if(s)s.hands=s.bet?[{cards:[],bet:s.bet,done:false,split:false,payout:0}]:[];
 for(let k=0;k<2;k++){for(const s of b.seats)if(s?.hands.length)s.hands[0].cards.push(draw(b));b.dealer.push(draw(b));}
 for(const s of b.seats)if(s?.hands[0]&&natural(s.hands[0]))s.hands[0].done=true;
 if(blackjackValue(b.dealer)===21)settle(r,b,now);else advance(r,b,now);
}
export function blackjackTick(r:Room,now:number):void{const b=(r as BRoom).blackjack;if(!b||b.deadline===null||now<b.deadline)return;
 if(b.phase==='betting'){if(b.seats.some(s=>s&&s.bet>0))deal(r,b,now);else b.deadline=null;}
 else if(b.phase==='playing'){const s=b.turn===null?null:b.seats[b.turn];if(s?.hands[b.hand])s.hands[b.hand].done=true;advance(r,b,now);}
 else{for(let i=0;i<b.seats.length;i++){const s=b.seats[i];if(s?.leaveAfter)b.seats[i]=null;else if(s){s.bet=0;s.hands=[];}}b.phase='betting';b.dealer=[];b.turn=null;b.deadline=null;b.revealed=false;}
}
export function blackjackAction(r:Room,who:Identity,action:BlackjackAction,now:number):void{
 const rr=r as BRoom,m=member(rr,who.id);ensure(m.approved,'Account approval required.',403);
 const b=state(rr),i=b.seats.findIndex(s=>s?.userId===who.id),s=i<0?null:b.seats[i];
 if(action.type==='join'){ensure(!s,'Already seated.');ensure(Number.isInteger(action.seat)&&action.seat>=0&&action.seat<6,'Invalid seat.');ensure(!b.seats[action.seat],'Seat occupied.');b.seats[action.seat]={userId:who.id,bet:0,hands:[],leaveAfter:false};return;}
 ensure(s,'Take a blackjack seat first.');
 if(action.type==='leave'){if(b.phase==='playing'&&s.hands.length){s.leaveAfter=true;for(const h of s.hands)h.done=true;if(b.turn===i)advance(rr,b,now);}else{if(b.phase==='betting')m.wallet+=s.bet;b.seats[i]=null;if(b.phase==='betting'&&!b.seats.some(x=>x&&x.bet))b.deadline=null;}return;}
 if(action.type==='bet'){ensure(b.phase==='betting','Betting is closed.');ensure(Number.isSafeInteger(action.amount)&&action.amount>=100&&action.amount<=100_000&&action.amount%2===0,'Bet must be even cents between 100 and 100000.');const diff=action.amount-s.bet;ensure(m.wallet>=diff,'Insufficient funds.');m.wallet-=diff;s.bet=action.amount;if(b.deadline===null)b.deadline=now+BET_MS;return;}
 ensure(b.phase==='playing'&&b.turn===i,'Not your turn.');const h=s.hands[b.hand];ensure(h&&!h.done,'Hand already complete.');
 if(action.type==='stand')h.done=true;
 else if(action.type==='hit'){h.cards.push(draw(b));if(blackjackValue(h.cards)>=21)h.done=true;}
 else if(action.type==='double'){ensure(h.cards.length===2,'Double requires two cards.');ensure(m.wallet>=h.bet,'Insufficient funds.');m.wallet-=h.bet;h.bet*=2;h.cards.push(draw(b));h.done=true;}
 else if(action.type==='split'){ensure(s.hands.length===1&&h.cards.length===2&&h.cards[0][0]===h.cards[1][0],'Split requires a matching pair; maximum two hands.');ensure(m.wallet>=h.bet,'Insufficient funds.');m.wallet-=h.bet;const c=h.cards.pop()!;h.split=true;const other:BlackjackHand={cards:[c],bet:h.bet,done:false,split:true,payout:0};h.cards.push(draw(b));other.cards.push(draw(b));s.hands.push(other);if(c[0]==='A'){h.done=true;other.done=true;}else{h.done=blackjackValue(h.cards)===21;other.done=blackjackValue(other.cards)===21;}}
 else ensure(false,'Invalid blackjack action.');
 advance(rr,b,now);
}
export function blackjackPublic(r:Room,who:Identity){const b=(r as BRoom).blackjack;if(!b)return null;
 const me=r.members.find(m=>m.id===who.id),mine=b.seats.findIndex(s=>s?.userId===who.id);
 return {phase:b.phase,round:b.round,deadline:b.deadline,turn:b.turn,hand:b.hand,dealer:b.dealer.map((c,i)=>i===0||b.revealed?c:'??'),dealerTotal:b.revealed?blackjackValue(b.dealer):null,seats:b.seats.map(s=>{if(!s)return null;const m=r.members.find(m=>m.id===s.userId);return {publicId:m?.publicId,name:m?.name,bet:s.bet,leaveAfter:s.leaveAfter,hands:s.hands.map(h=>({...h,cards:[...h.cards],total:blackjackValue(h.cards)}))};}),mySeat:mine,canAct:!!me?.approved&&b.phase==='playing'&&b.turn===mine&&mine>=0};
}
