import {isWholeCasinoAmount} from "./casino-amount";
import {ACTION_TURN_MS} from './turn-timer';
import {randomInt} from 'node:crypto';
import {ensure} from './errors';
import type {Room,Identity} from './types';

// Six-deck S17; initial Black 78 > blackjack, both paying 3:2; five-card Charlie pays 1:1. One split only; split aces receive one card,
// no resplit, no insurance/surrender. Double any initial two cards (including splits).
export type BlackjackHand={cards:string[];bet:number;done:boolean;split:boolean;payout:number;result?:string};
export const BLACKJACK_IDLE_MS=300_000;
export type BlackjackSeat={userId:string;bet:number;hands:BlackjackHand[];leaveAfter:boolean;idleRemaining?:number;idleDeadline?:number|null};
export type BlackjackState={phase:'betting'|'playing'|'settled';seats:(BlackjackSeat|null)[];dealer:string[];shoe:string[];turn:number|null;hand:number;deadline:number|null;round:number;revealed:boolean};
export type BlackjackAction={type:'join';seat:number}|{type:'leave'}|{type:'bet';amount:number}|{type:'hit'|'stand'|'double'|'split'};
type BRoom=Room & {blackjack?:BlackjackState};
const BET_MS=10_000,TURN_MS=ACTION_TURN_MS,BREAK_MS=5_000;
export function blackjackShoe(rng:(max:number)=>number=randomInt):string[]{
 const cards=Array.from({length:6},()=>[...'shcd'].flatMap(s=>[...'23456789TJQKA'].map(v=>v+s))).flat();
 for(let i=cards.length-1;i>0;i--){const j=rng(i+1);[cards[i],cards[j]]=[cards[j],cards[i]];}return cards;
}
export function blackjackValue(cards:string[]):number{let v=0,a=0;for(const c of cards){if(c[0]==='A'){v+=11;a++;}else v+='TJQK'.includes(c[0])?10:Number(c[0]);}while(v>21&&a-->0)v-=10;return v;}
function state(r:BRoom):BlackjackState{return r.blackjack??= {phase:'betting',seats:Array(6).fill(null),dealer:[],shoe:[],turn:null,hand:0,deadline:null,round:0,revealed:false};}
function member(r:BRoom,id:string){const m=r.members.find(m=>m.id===id);ensure(m,'Unknown member.',403);return m;}
function draw(b:BlackjackState){ensure(b.shoe.length,'Blackjack shoe exhausted.',500);return b.shoe.pop()!;}
// Only the original two-card deal qualifies. Split hands never gain a tier.
export function blackjackTier(cards:string[],split=false):number{
 if(split||cards.length!==2)return 0;
 const ranks=cards.map(c=>c[0]).sort().join('');
 if(ranks==='78'&&cards.every(c=>c[1]==='s'||c[1]==='c'))return 2;
 return blackjackValue(cards)===21?1:0;
}
const charlie=(h:BlackjackHand)=>h.cards.length===5&&blackjackValue(h.cards)<=21;
const tierName=(tier:number):string|null=>[null,'Blackjack','Black 78'][tier]??null;
export function blackjackAssets(r:Room):number{const b=(r as BRoom).blackjack;if(!b)return 0;return b.seats.reduce((n,s)=>n+(s?(b.phase==='betting'?s.bet:b.phase==='playing'?s.hands.reduce((v,h)=>v+h.bet,0):0):0),0);}
// Only open betting time consumes this budget. Persist the paused remainder so
// a long hand, settlement break, disconnect or restart cannot steal betting time.
function idleClocks(b:BlackjackState,now:number){
 for(const s of b.seats){if(!s)continue;
  s.idleRemaining??=BLACKJACK_IDLE_MS;
  if(b.phase==='betting'){
   if(s.idleDeadline==null)s.idleDeadline=now+s.idleRemaining;
  }else if(s.idleDeadline!=null){
   s.idleRemaining=Math.max(0,s.idleDeadline-now);s.idleDeadline=null;
  }
 }
}
function expireIdle(b:BlackjackState,now:number){
 if(b.phase!=='betting')return;
 for(let i=0;i<b.seats.length;i++){const s=b.seats[i];
  if(s&&s.bet===0&&s.hands.length===0&&s.idleDeadline!=null&&now>=s.idleDeadline)b.seats[i]=null;
 }
}
export function blackjackNeedsTick(b:BlackjackState,now:number):boolean{
 return (b.deadline!==null&&now>=b.deadline)||(b.phase==='betting'&&b.seats.some(s=>s&&s.bet===0&&(s.idleDeadline==null||now>=s.idleDeadline)));
}
function settle(r:BRoom,b:BlackjackState,now:number){
 b.revealed=true;
 // Capture the dealer's INITIAL tier before any S17 draws. A drawn 21 is normal.
 const dealerTier=blackjackTier(b.dealer);
 const needDealer=b.seats.some(s=>s?.hands.some(h=>blackjackValue(h.cards)<=21&&!blackjackTier(h.cards,h.split)&&!charlie(h)));
 if(!dealerTier&&needDealer)while(blackjackValue(b.dealer)<17)b.dealer.push(draw(b));
 const dv=blackjackValue(b.dealer);
 for(const s of b.seats){if(!s)continue;for(const h of s.hands){const v=blackjackValue(h.cards),tier=blackjackTier(h.cards,h.split);let p=0;
 if(tier||dealerTier){
  if(tier===dealerTier){p=h.bet;h.result='push';}
  else if(tier>dealerTier){p=h.bet*5/2;h.result=tier===1?'blackjack':'special';}
  else h.result='lose';
 }else if(v>21)h.result='bust';
 else if(charlie(h)){p=h.bet*2;h.result='charlie';}
 else if(dv>21||v>dv){p=h.bet*2;h.result='win';}else if(v===dv){p=h.bet;h.result='push';}else h.result='lose';
 member(r,s.userId).wallet+=p;r.house=(r.house??0)+h.bet-p;h.payout=p;h.done=true;
 }}
 b.phase='settled';b.turn=null;b.deadline=now+BREAK_MS;
}
function advance(r:BRoom,b:BlackjackState,now:number){for(let i=0;i<b.seats.length;i++){const s=b.seats[i];if(!s)continue;const j=s.hands.findIndex(h=>!h.done);if(j!==-1){b.turn=i;b.hand=j;b.deadline=now+TURN_MS;return;}}settle(r,b,now);}
function deal(r:BRoom,b:BlackjackState,now:number){
 // At most 12 player hands plus dealer; reserve well beyond the maximum reachable draws.
 if(b.shoe.length<156)b.shoe=blackjackShoe();
 b.phase='playing';idleClocks(b,now);b.round++;b.revealed=false;b.dealer=[];
 for(const s of b.seats)if(s)s.hands=s.bet?[{cards:[],bet:s.bet,done:false,split:false,payout:0}]:[];
 for(let k=0;k<2;k++){for(const s of b.seats)if(s?.hands.length)s.hands[0].cards.push(draw(b));b.dealer.push(draw(b));}
 for(const s of b.seats)if(s?.hands[0]&&blackjackTier(s.hands[0].cards,s.hands[0].split)>0)s.hands[0].done=true;
 if(blackjackTier(b.dealer)>0)settle(r,b,now);else advance(r,b,now);
}
export function blackjackTick(r:Room,now:number):void{const b=(r as BRoom).blackjack;if(!b)return;
 idleClocks(b,now);expireIdle(b,now);
 if(b.deadline===null||now<b.deadline)return;
 if(b.phase==='betting'){if(b.seats.some(s=>s&&s.bet>0))deal(r,b,now);else b.deadline=null;}
 else if(b.phase==='playing'){
  const i=b.turn,s=i===null?null:b.seats[i];
  if(s&&i!==null){r.house=(r.house??0)+s.hands.reduce((n,h)=>n+h.bet,0);b.seats[i]=null;}
  advance(r,b,now);
 }
 else{for(let i=0;i<b.seats.length;i++){const s=b.seats[i];if(s?.leaveAfter)b.seats[i]=null;else if(s){s.bet=0;s.hands=[];}}b.phase='betting';b.dealer=[];b.turn=null;b.deadline=null;b.revealed=false;idleClocks(b,now);expireIdle(b,now);}
}
export function blackjackAction(r:Room,who:Identity,action:BlackjackAction,now:number):void{
 const rr=r as BRoom,m=member(rr,who.id);
 const b=state(rr);
 idleClocks(b,now);expireIdle(b,now);
 ensure(!(b.phase==='playing'&&b.deadline!==null&&now>=b.deadline),'The blackjack turn expired.',409);
 const i=b.seats.findIndex(s=>s?.userId===who.id),s=i<0?null:b.seats[i];
 if(action.type==='join'){ensure(!s,'Already seated.');ensure(Number.isInteger(action.seat)&&action.seat>=0&&action.seat<6,'Invalid seat.');ensure(!b.seats[action.seat],'Seat occupied.');b.seats[action.seat]={userId:who.id,bet:0,hands:[],leaveAfter:false,idleRemaining:BLACKJACK_IDLE_MS,idleDeadline:b.phase==='betting'?now+BLACKJACK_IDLE_MS:null};return;}
 ensure(s,'Take a blackjack seat first.');
 if(action.type==='leave'){if(b.phase==='playing'&&s.hands.length){s.leaveAfter=true;for(const h of s.hands)h.done=true;if(b.turn===i)advance(rr,b,now);}else{if(b.phase==='betting')m.wallet+=s.bet;b.seats[i]=null;if(b.phase==='betting'&&!b.seats.some(x=>x&&x.bet))b.deadline=null;}return;}
 if(action.type==='bet'){ensure(b.phase==='betting','Betting is closed.');ensure(isWholeCasinoAmount(action.amount)&&action.amount>=100&&action.amount<=100_000,'Bet must be whole dollars between $1 and $1,000.');const diff=action.amount-s.bet;ensure(m.wallet>=diff,'Insufficient funds.');m.wallet-=diff;s.bet=action.amount;s.idleRemaining=BLACKJACK_IDLE_MS;s.idleDeadline=now+BLACKJACK_IDLE_MS;if(b.deadline===null)b.deadline=now+BET_MS;return;}
 ensure(b.phase==='playing'&&b.turn===i,'Not your turn.');const h=s.hands[b.hand];ensure(h&&!h.done,'Hand already complete.');
 if(action.type==='stand')h.done=true;
 else if(action.type==='hit'){h.cards.push(draw(b));if(blackjackValue(h.cards)>=21||charlie(h))h.done=true;}
 else if(action.type==='double'){ensure(h.cards.length===2,'Double requires two cards.');ensure(m.wallet>=h.bet,'Insufficient funds.');m.wallet-=h.bet;h.bet*=2;h.cards.push(draw(b));h.done=true;}
 else if(action.type==='split'){ensure(s.hands.length===1&&h.cards.length===2&&h.cards[0][0]===h.cards[1][0],'Split requires a matching pair; maximum two hands.');ensure(m.wallet>=h.bet,'Insufficient funds.');m.wallet-=h.bet;const c=h.cards.pop()!;h.split=true;const other:BlackjackHand={cards:[c],bet:h.bet,done:false,split:true,payout:0};h.cards.push(draw(b));other.cards.push(draw(b));s.hands.push(other);if(c[0]==='A'){h.done=true;other.done=true;}else{h.done=blackjackValue(h.cards)===21;other.done=blackjackValue(other.cards)===21;}}
 else ensure(false,'Invalid blackjack action.');
 advance(rr,b,now);
}
export function blackjackPublic(r:Room,who:Identity){const b=(r as BRoom).blackjack;if(!b)return null;
 const me=r.members.find(m=>m.id===who.id),mine=b.seats.findIndex(s=>s?.userId===who.id);
 return {phase:b.phase,round:b.round,deadline:b.deadline,turn:b.turn,hand:b.hand,dealer:b.dealer.map((c,i)=>i===0||b.revealed?c:'??'),dealerTotal:b.revealed?blackjackValue(b.dealer):null,dealerHandName:b.revealed?tierName(blackjackTier(b.dealer)):null,seats:b.seats.map(s=>{if(!s)return null;const m=r.members.find(m=>m.id===s.userId);return {publicId:m?.publicId,name:m?.name,bet:s.bet,leaveAfter:s.leaveAfter,idleDeadline:b.phase==='betting'&&s.bet===0?(s.idleDeadline??null):null,hands:s.hands.map(h=>({...h,cards:[...h.cards],total:blackjackValue(h.cards),handName:tierName(blackjackTier(h.cards,h.split))??(charlie(h)?'Charlie':null)}))};}),mySeat:mine,canAct:!!me&&b.phase==='playing'&&b.turn===mine&&mine>=0};
}

export const BLACKJACK_TABLE_IDS=['lounge','salon','terrace'] as const;
export type BlackjackTableId=typeof BLACKJACK_TABLE_IDS[number];
export type BlackjackTablesState={tables:Partial<Record<BlackjackTableId,BlackjackState>>};
export type BlackjackTablesAction=BlackjackAction & {tableId:BlackjackTableId};
type TablesRoom=Room & {blackjackTables?:BlackjackTablesState};
function tableRoom(r:TablesRoom,id:BlackjackTableId):BRoom{return {...r,blackjack:r.blackjackTables?.tables[id]};}
function saveTable(r:TablesRoom,id:BlackjackTableId,scoped:BRoom){r.blackjackTables??={tables:{}};r.blackjackTables.tables[id]=scoped.blackjack;r.house=scoped.house;}
export function blackjackTablesAssets(r:Room):number{const rr=r as TablesRoom;return BLACKJACK_TABLE_IDS.reduce((n,id)=>n+blackjackAssets(tableRoom(rr,id)),0);}
export function blackjackTablesAction(r:Room,who:Identity,action:BlackjackTablesAction,now:number):void{
 ensure(BLACKJACK_TABLE_IDS.includes(action.tableId),'Unknown blackjack table.');
 const rr=r as TablesRoom;
 if(action.type==='join')ensure(!BLACKJACK_TABLE_IDS.some(id=>rr.blackjackTables?.tables[id]?.seats.some(s=>s?.userId===who.id)),'Leave your current blackjack table first.');
 const scoped=tableRoom(rr,action.tableId);blackjackAction(scoped,who,action,now);saveTable(rr,action.tableId,scoped);
}
export function blackjackTablesTick(r:Room,now:number):void{const rr=r as TablesRoom;for(const id of BLACKJACK_TABLE_IDS){if(!rr.blackjackTables?.tables[id])continue;const scoped=tableRoom(rr,id);blackjackTick(scoped,now);saveTable(rr,id,scoped);}}
export function blackjackTablesPublic(r:Room,who:Identity){const rr=r as TablesRoom,m=r.members.find(m=>m.id===who.id);
 return {tables:BLACKJACK_TABLE_IDS.map(id=>{const scoped=tableRoom(rr,id);state(scoped);const b=scoped.blackjack!,p=blackjackPublic(scoped,who)!;const s=p.mySeat<0?null:b.seats[p.mySeat],h=s?.hands[b.hand];const can=p.canAct&&!!h&&!h.done;
 return {id,phase:p.phase,round:p.round,deadline:p.deadline,turn:p.turn===null?null:{seat:p.turn,hand:p.hand},dealer:{cards:p.dealer.map(c=>c==='??'?'?':c)},dealerTotal:p.dealerTotal,dealerHandName:p.dealerHandName,minBet:100,maxBet:100_000,seats:p.seats.map((s,i)=>s?{...s,isYou:i===p.mySeat}:null),mySeat:p.mySeat,legal:{hit:can,stand:can,double:can&&h!.cards.length===2&&(m?.wallet??0)>=h!.bet,split:can&&s!.hands.length===1&&h!.cards.length===2&&h!.cards[0][0]===h!.cards[1][0]&&(m?.wallet??0)>=h!.bet}};
 })};
}

/** Unsettled wagers at book value; settled returns already live in wallet. */
export function blackjackMemberAssets(r:Room,userId:string):number{
 const rr=r as TablesRoom;
 return BLACKJACK_TABLE_IDS.reduce((sum,id)=>{
  const b=rr.blackjackTables?.tables[id];if(!b||b.phase==='settled')return sum;
  return sum+b.seats.reduce((n,s)=>n+(!s||s.userId!==userId?0:b.phase==='betting'?s.bet:s.hands.reduce((v,h)=>v+h.bet,0)),0);
 },0);
}
export type BlackjackTablesPublic=ReturnType<typeof blackjackTablesPublic>;
export type BlackjackPublic=ReturnType<typeof blackjackPublic>;
