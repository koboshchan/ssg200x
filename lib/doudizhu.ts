import {randomInt,randomUUID} from "node:crypto";
import {wordlist} from "@scure/bip39/wordlists/english.js";
import {classify,beats,rank,shuffled,type Combo} from "./doudizhu-rules";
import {ensure} from "./errors";
import {casinoLimits} from "./casino-limits";
import {applyDoudizhuReaction,type DoudizhuReaction} from "./doudizhu-reactions";
import {audit} from "./audit";
import type {Room,Identity} from "./types";
export type DoudizhuInput={type:"spectate"|"watch"|"create"|"join"|"ready"|"bid"|"play"|"pass"|"leave"|"visibility"|"double"|"reaction";watchSeat?:number;doubleMultiplier?:number;kind?:"emote"|"throw";value?:string;target?:number;targetId?:string;expectedPrice?:number;isPublic?:boolean;code?:string;beansPerDollar?:number;maxLoss?:number;cards?:string[];bid?:number;requestId:string;requestAt:number;version?:number};
export type DoudizhuPlayer={userId:string;ready:boolean;auto:boolean;hand:string[];escrow:number;plays:number;doubleMultiplier?:1|2|4;doubleChosen?:boolean};
export type DoudizhuRoom={code:string;spectators?:{userId:string;seat:number|null;seenAt:number}[];ownerId?:string;isPublic?:boolean;base?:number;rate?:number;scoringMode?:"beans"|"legacy-rate";beansPerDollar?:number;baseBeans?:number;maxLoss:number;scaledDoubleCaps?:boolean;reactions?:DoudizhuReaction[];idleDeadline?:number|null;version:number;phase:"waiting"|"bidding"|"doubling"|"playing"|"revealing"|"finished";revealWinner?:number;handId:string;players:DoudizhuPlayer[];kitty:string[];turn:number;deadline:number|null;landlord:number|null;bid:number;bidder:number|null;bids:number;multiplier:number;trick:{cards:string[];combo:Combo;seat:number}|null;passes:number;settled:boolean;result:null|{winner:number;spring:boolean;unit:number;unitBeans?:number;beanDeltas?:number[];beanDeltaExact?:string[];deltas:number[];settlementId:string}};
export const DOUDIZHU_REVEAL_MS=5_000;
export const DOUDIZHU_TURN_MS=60_000;
export const DOUDIZHU_IDLE_MS=5*60_000;
function idleEligible(g:DoudizhuRoom){return (g.phase==="waiting"||g.phase==="finished")&&!g.players.some(p=>p.ready);}
function syncIdle(g:DoudizhuRoom,now:number){if(idleEligible(g)){g.idleDeadline??=now+DOUDIZHU_IDLE_MS;}else delete g.idleDeadline;}
export const DOUDIZHU_RULES={turnMs:DOUDIZHU_TURN_MS,description:"Happy Beans: 1000 base beans times bid and multiplier. Convert beans to cents by flooring beans × 100 / beansPerDollar before caps. Result bean deltas are exact settled cents × beansPerDollar / 100, including fractional beans. Each player initially reserves the room base maximum loss. In new rooms the loss cap scales with the landlord and farmer double choices: a farmer reserves base cap × their choice × the landlord choice; the landlord reserves base cap × their choice × the highest farmer choice. A choice is allowed only when all affected wallets cover their increased reserves. Bids, bombs and spring change the score, not this funded cap. Legacy rooms keep their original funded caps. Bids, bombs, rocket and spring multiply points. Black 78 (a black seven plus black eight) counts as a bomb of four threes: it beats non-bombs and doubles the multiplier, ties four threes and other Black 78 plays, and loses to higher bombs and the joker rocket. Loss cannot exceed reserved chips; a losing landlord pays at most their reserve, split proportionally to farmer claims, with remainder cents ordered by largest fractional share then lower seat. After landlord selection everyone chooses No double x1, Double x2 or Super double x4. Each landlord-farmer claim multiplies both players’ choices before converting beans to cents. Unanswered choices time out to x1."};
function ownerOf(g:DoudizhuRoom){return g.ownerId??g.players[0]?.userId;}
export function doudizhuMaxRate(r:Room){return Number.isSafeInteger(r.doudizhuMaxRate)&&r.doudizhuMaxRate!>=1&&r.doudizhuMaxRate!<=1000000?r.doudizhuMaxRate!:1000;}
export function doudizhuMaxBeansPerDollar(r:Room){return Number.isSafeInteger(r.doudizhuMaxBeansPerDollar)&&r.doudizhuMaxBeansPerDollar!>=1&&r.doudizhuMaxBeansPerDollar!<=1000000000?r.doudizhuMaxBeansPerDollar!:1000000;}
/** Exact signed decimal beans for cent transfers; no unsafe Number multiplication. */
export function settledBeansExact(cents:number,beansPerDollar:number):string{
 const product=BigInt(cents)*BigInt(beansPerDollar),negative=product<0n,absolute=negative?-product:product;
 const whole=absolute/100n,remainder=absolute%100n;
 return (negative?"-":"")+whole.toString()+(remainder?"."+remainder.toString().padStart(2,"0").replace(/0$/,""):"");
}
export function doudizhuAssets(r:Room,userId?:string){return (r.doudizhu??[]).reduce((n,g)=>n+g.players.filter(p=>!userId||p.userId===userId).reduce((s,p)=>s+p.escrow,0),0);}
const system:Identity={id:"doudizhu-system",name:"Game timer",email:"",admin:false};
function member(r:Room,id:string){const m=r.members.find(m=>m.id===id);ensure(m,"Account not found.",404);return m;}
function escrow(r:Room,g:DoudizhuRoom,p:DoudizhuPlayer){const m=member(r,p.userId),amount=g.maxLoss;ensure(Number.isSafeInteger(amount)&&m.wallet>=amount,"Insufficient wallet for maximum-loss reserve.");m.wallet-=amount;p.escrow=amount;}
/** Fund every affected exposure before committing any choice. No balance can go negative. */
export function doudizhuDoubleReserves(g:DoudizhuRoom,seat:number,multiplier:number){
 ensure([1,2,4].includes(multiplier),"Choose x1, x2 or x4.");
 if(!g.scaledDoubleCaps)return g.players.map(p=>p.escrow);
 ensure(g.landlord!==null,"No landlord.",500);
 const choices=g.players.map((p,i)=>i===seat?multiplier:p.doubleMultiplier??1),landlord=g.landlord;
 return choices.map((m,i)=>{
  const other=i===landlord?Math.max(...choices.filter((_,j)=>j!==landlord)):choices[landlord];
  const reserve=g.maxLoss*m*other;
  ensure(Number.isSafeInteger(reserve)&&reserve>=0,"Invalid scaled reserve.",500);return reserve;
 });
}
function doubleOption(r:Room,g:DoudizhuRoom,seat:number,multiplier:number){
 const reserves=doudizhuDoubleReserves(g,seat,multiplier);
 return {multiplier,reserve:reserves[seat],additionalReserve:Math.max(0,reserves[seat]-g.players[seat].escrow),available:reserves.every((amount,i)=>member(r,g.players[i].userId).wallet>=amount-g.players[i].escrow)};
}
function deal(g:DoudizhuRoom,now:number){delete g.idleDeadline;delete g.revealWinner;const deck=shuffled();ensure(deck.length===54&&new Set(deck).size===54,"Invalid deck.",500);g.handId=randomUUID();g.players.forEach((p,i)=>{p.hand=deck.slice(i*17,i*17+17);p.plays=0;p.doubleMultiplier=1;p.doubleChosen=false;});g.kitty=deck.slice(51);g.phase="bidding";g.turn=0;g.deadline=now+DOUDIZHU_TURN_MS;g.bid=0;g.bidder=null;g.bids=0;g.multiplier=1;g.trick=null;g.passes=0;g.landlord=null;g.settled=false;g.result=null;}
function settle(r:Room,g:DoudizhuRoom,winner:number,now:number){
 if(g.settled)return;
 ensure(g.landlord!==null,"No landlord.",500);
 const landlord=g.landlord,landlordWon=winner===landlord;
 const spring=landlordWon?g.players.every((p,i)=>i===landlord||p.plays===0):g.players[landlord].plays<=1;
 if(spring)g.multiplier=Math.min(1_000_000,g.multiplier*2);
 const isBeans=g.scoringMode==="beans";
 const unitBeans=isBeans?g.baseBeans!*g.bid*g.multiplier:undefined;
 const unit=isBeans?Number(BigInt(unitBeans!)*100n/BigInt(g.beansPerDollar!)):g.rate!*100*g.bid*g.multiplier,deltas=[0,0,0];
 const farmers=[0,1,2].filter(i=>i!==landlord);
 const claims=farmers.map(i=>{
  const factor=BigInt(g.players[landlord].doubleMultiplier??1)*BigInt(g.players[i].doubleMultiplier??1);
  return isBeans?BigInt(unitBeans!)*factor*100n/BigInt(g.beansPerDollar!):BigInt(unit)*factor;
 });
 if(landlordWon){farmers.forEach((i,n)=>{const loss=Number(claims[n]<BigInt(g.players[i].escrow)?claims[n]:BigInt(g.players[i].escrow));deltas[i]=-loss;deltas[landlord]+=loss;});}
 else{
  const wanted=claims.reduce((a,b)=>a+b,0n),reserve=BigInt(g.players[landlord].escrow),total=wanted<reserve?wanted:reserve;
  const shares=claims.map(c=>wanted?total*c/wanted:0n);
  let remainder=total-shares.reduce((a,b)=>a+b,0n);
  const order=farmers.map((seat,n)=>({seat,n,fraction:wanted?total*claims[n]%wanted:0n})).sort((a,b)=>a.fraction===b.fraction?a.seat-b.seat:a.fraction>b.fraction?-1:1);
  for(const item of order){if(remainder===0n)break;shares[item.n]++;remainder--;}
  deltas[landlord]=-Number(total);farmers.forEach((i,n)=>deltas[i]=Number(shares[n]));
 }
 const settlementId=g.handId+":settlement";
 g.players.forEach((p,i)=>{ensure(Number.isSafeInteger(p.escrow+deltas[i])&&p.escrow+deltas[i]>=0,"Invalid settlement.",500);member(r,p.userId).wallet+=p.escrow+deltas[i];p.escrow=0;p.ready=false;});
 g.settled=true;g.phase="finished";g.deadline=null;g.idleDeadline=now+DOUDIZHU_IDLE_MS;g.result={winner,spring,unit,deltas,settlementId,...(isBeans?{unitBeans,beanDeltas:deltas.map(c=>Number(settledBeansExact(c,g.beansPerDollar!))),beanDeltaExact:deltas.map(c=>settledBeansExact(c,g.beansPerDollar!))}:{})};
 audit(r,system,"doudizhu.settlement",settlementId,null,{handId:g.handId,code:g.code,...g.result,at:now});
}
function action(r:Room,g:DoudizhuRoom,seat:number,type:"bid"|"play"|"pass",input:Partial<DoudizhuInput>,now:number){
 ensure(g.turn===seat,"Not your turn.",409);
 if(type==="bid"){
  ensure(g.phase==="bidding","Not bidding.",409);const bid=input.bid;
  ensure(Number.isInteger(bid)&&bid!>=0&&bid!<=3&&(bid===0||bid!>g.bid),"Bid must pass or raise to 1, 2 or 3.");
  g.bids++;if(bid){g.bid=bid;g.bidder=seat;}
  if(bid===3||g.bids===3){if(g.bidder===null){deal(g,now);return;}g.landlord=g.bidder;g.players[g.landlord].hand.push(...g.kitty);g.phase="doubling";g.turn=g.landlord;}
  else g.turn=(seat+1)%3;
 }else{
  ensure(g.phase==="playing","Not playing.",409);const p=g.players[seat];
  if(type==="pass"){
   ensure(g.trick&&g.trick.seat!==seat,"Cannot pass when leading.");g.passes++;
   if(g.passes===2){g.turn=g.trick.seat;g.trick=null;g.passes=0;}else g.turn=(seat+1)%3;
  }else{
   const cards=input.cards;ensure(Array.isArray(cards)&&cards.length>0&&cards.length<=20&&cards.every(c=>typeof c==="string")&&new Set(cards).size===cards.length,"Choose unique cards.");
   ensure(cards.every(c=>p.hand.includes(c)),"Cards are not in your hand.");
   const combo=classify(cards);ensure(combo,"Invalid card combination.");ensure(!g.trick||beats(combo,g.trick.combo),"Play must beat the current combination.");
   p.hand=p.hand.filter(c=>!cards.includes(c));p.plays++;g.trick={cards:[...cards],combo,seat};g.passes=0;
   if(combo.kind==="bomb"||combo.kind==="rocket")g.multiplier=Math.min(1_000_000,g.multiplier*2);
   if(!p.hand.length){g.phase="revealing";g.revealWinner=seat;g.deadline=now+DOUDIZHU_REVEAL_MS;return;}g.turn=(seat+1)%3;
  }
 }
 g.deadline=now+DOUDIZHU_TURN_MS;
}
export function doudizhuNeedsTick(r:Room,now:number){return (r.doudizhu??[]).some(g=>!g.players.length||(idleEligible(g)&&(g.idleDeadline==null||now>=g.idleDeadline))||(!idleEligible(g)&&g.idleDeadline!=null)||(g.phase==="bidding"||g.phase==="doubling"||g.phase==="playing"||g.phase==="revealing")&&g.deadline!==null&&now>=g.deadline);}
export function tickDoudizhu(r:Room,now:number){let changed=false;for(const g of [...r.doudizhu??[]]){
 // Store mutations commit refunds, room removal and audit together under CAS.
 if(!g.players.length||(idleEligible(g)&&g.idleDeadline!=null&&now>=g.idleDeadline)){
  const refunds=g.players.map(p=>({userId:p.userId,amount:p.escrow}));
  // Validate every account before changing any balance.
  const accounts=g.players.map(p=>{ensure(Number.isSafeInteger(p.escrow)&&p.escrow>=0,"Invalid reserve.",500);return member(r,p.userId);});
  g.players.forEach((p,i)=>{accounts[i].wallet+=p.escrow;p.escrow=0;});
  r.doudizhu=r.doudizhu!.filter(x=>x!==g);
  audit(r,system,"doudizhu.idle_cleanup",g.handId,null,{code:g.code,idleDeadline:g.idleDeadline,refunds,at:now});
  changed=true;continue;
 }
 const prior=g.idleDeadline;syncIdle(g,now);if(prior!==g.idleDeadline){g.version++;changed=true;}
 if((g.phase==="bidding"||g.phase==="doubling"||g.phase==="playing"||g.phase==="revealing")&&g.deadline!==null&&now>=g.deadline){
 if(g.phase==="revealing"){ensure(Number.isInteger(g.revealWinner)&&g.revealWinner!>=0&&g.revealWinner!<g.players.length,"Invalid reveal winner.",500);settle(r,g,g.revealWinner!,now);delete g.revealWinner;g.version++;changed=true;continue;}
 if(g.phase==="doubling"){g.players.forEach(p=>{if(!p.doubleChosen){p.doubleMultiplier=1;p.doubleChosen=true;}});g.phase="playing";g.turn=g.landlord!;g.deadline=now+DOUDIZHU_TURN_MS;g.version++;changed=true;continue;}
 const p=g.players[g.turn];if(g.phase==="bidding")action(r,g,g.turn,"bid",{bid:0},now);
 else if(g.trick)action(r,g,g.turn,"pass",{},now);
 else action(r,g,g.turn,"play",{cards:[[...p.hand].sort((a,b)=>rank(a)-rank(b)||a.localeCompare(b))[0]]},now);
 g.version++;changed=true;
 }}return changed;}
function doudizhuFingerprint(input:DoudizhuInput){return JSON.stringify([input.type,input.watchSeat,input.code,input.version,input.requestAt,input.isPublic,input.beansPerDollar,input.maxLoss,input.cards,input.bid,input.doubleMultiplier,input.kind,input.value,input.target,input.targetId,input.expectedPrice]);}
export function applyDoudizhu(r:Room,who:Identity,input:DoudizhuInput,now=Date.now()){
 ensure(input&&["spectate","watch","create","join","ready","bid","play","pass","leave","visibility","double","reaction"].includes(input.type),"Unsupported game action.");
 ensure(!("auto" in input)&&!("bot" in input)&&!("simulate" in input),"Autoplay is not supported.");
 ensure(input&&typeof input.requestId==="string"&&/^[a-zA-Z0-9_-]{8,128}$/.test(input.requestId),"Invalid request ID.");
 ensure(Number.isSafeInteger(input.requestAt)&&now-input.requestAt>=-10_000&&now-input.requestAt<=120_000,"Request expired.",409);
 const receipt=(r.doudizhuReceipts??[]).find(x=>x.id===input.requestId);
 if(receipt){ensure(receipt.userId===who.id&&(!receipt.fingerprint||receipt.fingerprint===doudizhuFingerprint(input)),"Invalid request.",409);return;}
 const retained=(r.doudizhuReceipts??[]).filter(x=>now-x.at<300_000);ensure(retained.length<4096,"Too many recent moves. Try again shortly.",429);
 const m=member(r,who.id);ensure(m.approved&&!m.accessRevoked,"Access denied.",403);
 const games=r.doudizhu??=[];let own=games.find(g=>g.players.some(p=>p.userId===who.id));
 const code=typeof input.code==="string"?input.code.trim().toLowerCase().replace(/[\s-]+/g," "):"";
 let g: DoudizhuRoom|undefined=code?games.find(g=>g.code===code):own??games.find(g=>g.spectators?.some(s=>s.userId===who.id&&now-s.seenAt<DOUDIZHU_SPECTATOR_TTL));
 if(input.type==="spectate"||input.type==="watch"){
  ensure(g,"Room not found.",404);ensure(!own,"Leave your existing room first.",409);
  const watching=(g.spectators??[]).find(s=>s.userId===who.id);
  if(input.type==="watch"){ensure(watching&&now-watching.seenAt<DOUDIZHU_SPECTATOR_TTL,"Spectate this room first.",403);ensure(Number.isInteger(input.watchSeat)&&input.watchSeat!>=0&&input.watchSeat!<g.players.length,"Choose a seated player.");}
  // At most one watched room per account. No reserve or wallet operation.
  const live=(g.spectators??[]).filter(s=>s.userId!==who.id&&now-s.seenAt<DOUDIZHU_SPECTATOR_TTL);
  ensure(live.length<200,"Too many spectators.",409);
  for(const game of games)game.spectators=(game.spectators??[]).filter(s=>s.userId!==who.id);
  g.spectators=[...live,{userId:who.id,seat:input.type==="watch"?input.watchSeat!:null,seenAt:now}];
 }else if(input.type==="leave"&&g?.spectators?.some(s=>s.userId===who.id)&&!own){
  g.spectators=g.spectators.filter(s=>s.userId!==who.id);
 }else if(input.type==="create"){
  ensure(!own,"Leave your existing room first.",409);ensure(input.isPublic===undefined||typeof input.isPublic==="boolean","Visibility must be boolean.");ensure(!("rate" in input),"New rooms use beansPerDollar, not rate.");const beansPerDollar=input.beansPerDollar??10,maxLoss=input.maxLoss??10000;ensure(Number.isSafeInteger(beansPerDollar)&&beansPerDollar>=1&&beansPerDollar<=doudizhuMaxBeansPerDollar(r),"Beans per dollar exceeds the current admin maximum.");ensure(Number.isSafeInteger(maxLoss)&&maxLoss>=100&&maxLoss<=100000000,"Maximum loss must be 100 to 100000000 cents.");
  let newCode:string;do{newCode=Array.from({length:3},()=>wordlist[randomInt(wordlist.length)]).join(" ");}while(games.some(g=>g.code===newCode));
  ensure(games.length<200,"Too many rooms.",409);
  g={code:newCode,ownerId:who.id,isPublic:input.isPublic??false,scoringMode:"beans",beansPerDollar,baseBeans:1000,maxLoss,scaledDoubleCaps:true,version:0,phase:"waiting",handId:randomUUID(),players:[],kitty:[],turn:0,deadline:null,landlord:null,bid:0,bidder:null,bids:0,multiplier:1,trick:null,passes:0,settled:false,result:null};games.push(g);
  const p:DoudizhuPlayer={userId:who.id,ready:false,auto:false,hand:[],escrow:0,plays:0};escrow(r,g,p);g.players.push(p);
 }else{
  ensure(g,"Room not found.",404);const seat=g.players.findIndex(p=>p.userId===who.id);
  if(input.type==="join"){ensure(!own,"Leave your existing room first.",409);ensure(g.phase==="waiting"&&g.players.length<3,"Room is full or started.",409);const p:DoudizhuPlayer={userId:who.id,ready:false,auto:false,hand:[],escrow:0,plays:0};escrow(r,g,p);g.players.push(p);
  }else{
   ensure(seat>=0,"Join this room first.",403);
   if(input.type==="reaction"){
    applyDoudizhuReaction(r,g,who,input,now);
   }else if(input.type==="visibility"){
    ensure(ownerOf(g)===who.id,"Only the room owner can change visibility.",403);
    ensure(g.phase==="waiting"||g.phase==="finished","Visibility can change only between hands.",409);
    ensure(input.version===g.version&&Number.isSafeInteger(input.version),"The room changed. Refresh first.",409);
    ensure(typeof input.isPublic==="boolean","Visibility must be boolean.");
    g.ownerId=who.id;g.isPublic=input.isPublic;
   }else if(input.type==="leave"){
    ensure(g.phase==="waiting"||g.phase==="finished","You can leave only between hands.",409);
    {const departingOwner=ownerOf(g)===who.id;m.wallet+=g.players[seat].escrow;g.players.splice(seat,1);if(departingOwner&&g.players.length)g.ownerId=g.players[0].userId;if(!g.players.length)r.doudizhu=games.filter(x=>x!==g);}
   }else{
    ensure(Number.isSafeInteger(input.version)&&input.version===g.version,"The turn changed. Refresh first.",409);
    if(input.type==="double"){
     ensure(g.phase==="doubling"&&g.deadline!==null&&now<g.deadline,"Not choosing doubles.",409);
     ensure([1,2,4].includes(input.doubleMultiplier!),"Choose x1, x2 or x4.");
     const p=g.players[seat];ensure(!p.doubleChosen,"Double already chosen.",409);
     const game=g,reserves=doudizhuDoubleReserves(game,seat,input.doubleMultiplier!);
     // Validate all accounts first. Store CAS commits this debit with the choice and receipt.
     const accounts=g.players.map(p=>member(r,p.userId));
     ensure(reserves.every((amount,i)=>accounts[i].wallet>=amount-game.players[i].escrow),"Insufficient wallet for increased maximum-loss reserves.");
     g.players.forEach((p,i)=>{accounts[i].wallet-=reserves[i]-p.escrow;p.escrow=reserves[i];});
     p.doubleMultiplier=input.doubleMultiplier as 1|2|4;p.doubleChosen=true;
     if(g.players.every(p=>p.doubleChosen)){g.phase="playing";g.turn=g.landlord!;g.deadline=now+DOUDIZHU_TURN_MS;}
    }else if(input.type==="ready"){
     ensure(g.phase==="waiting"||g.phase==="finished","Hand already started.",409);
     if(g.phase==="finished"){g.phase="waiting";g.players.forEach(p=>{p.auto=false;p.hand=[];});}
     const p=g.players[seat];ensure(!p.ready,"Already ready.",409);if(!p.escrow)escrow(r,g,p);p.ready=true;
     if(g.players.length===3&&g.players.every(p=>p.ready))deal(g,now);
    }else{
     ensure(g.deadline!==null&&now<g.deadline,"Turn expired.",409);
     ensure(["bid","play","pass"].includes(input.type),"Invalid move.");
     action(r,g,seat,input.type as "bid"|"play"|"pass",input,now);
    }
   }
  }
 }
 if(input.type==="join"||input.type==="create")for(const game of games)game.spectators=(game.spectators??[]).filter(s=>s.userId!==who.id);
 const spectatorAction=input.type==="spectate"||input.type==="watch"||(input.type==="leave"&&!own);
 if(!spectatorAction){syncIdle(g!,now);g!.version++;}
 audit(r,who,"doudizhu."+input.type,g!.handId,null,{code:g!.code,version:g!.version,requestId:input.requestId});
 r.doudizhuReceipts=[{id:input.requestId,userId:who.id,at:now,fingerprint:doudizhuFingerprint(input)},...retained];
}
export const DOUDIZHU_SPECTATOR_TTL=45_000;
/** Poll heartbeat never changes gameplay version and never revives expired access. */
export function touchDoudizhuSpectator(r:Room,userId:string,now=Date.now()){
 for(const g of r.doudizhu??[]){const s=g.spectators?.find(s=>s.userId===userId&&now-s.seenAt<DOUDIZHU_SPECTATOR_TTL);if(s)s.seenAt=now;}
}
export function publicDoudizhu(r:Room,who:Identity,code?:string){
 const own=(r.doudizhu??[]).find(g=>g.players.some(p=>p.userId===who.id));
 const now=Date.now(),watched=(r.doudizhu??[]).find(g=>g.spectators?.some(s=>s.userId===who.id&&now-s.seenAt<DOUDIZHU_SPECTATOR_TTL));
 const accessible=own??watched;
 // Knowing words alone only reveals the preview. Spectating explicitly grants one chosen POV.
 const g=accessible&&(!code||accessible.code===code.trim().toLowerCase().replace(/[\s-]+/g," "))?accessible:undefined;
 const spectator=g&&!own?g.spectators?.find(s=>s.userId===who.id):undefined;
 const preview=code?(r.doudizhu??[]).find(x=>x.code===code.trim().toLowerCase().replace(/[\s-]+/g," ")):undefined;
 const recruitingRooms=(r.doudizhu??[]).filter(x=>x.isPublic===true&&x.phase==="waiting"&&x.players.length>0&&x.players.length<3).map(x=>({code:x.code,count:x.players.length,scoringMode:x.scoringMode??"legacy-rate",beansPerDollar:x.beansPerDollar,baseBeans:x.baseBeans,rate:x.rate,maxLoss:x.maxLoss}));
 return {reactionPrices:{egg:casinoLimits(r).pokerEggPrice,tomato:casinoLimits(r).pokerTomatoPrice},recruitingRooms,preview:preview?{code:preview.code,scoringMode:preview.scoringMode??"legacy-rate",beansPerDollar:preview.beansPerDollar,baseBeans:preview.baseBeans,rate:preview.rate,maxLoss:preview.maxLoss,count:preview.players.length,phase:preview.phase}:null,houseRules:DOUDIZHU_RULES,maxBeansPerDollar:doudizhuMaxBeansPerDollar(r),maxRate:doudizhuMaxRate(r),wallet:r.members.find(m=>m.id===who.id)?.wallet??0,room:g?{spectating:!!spectator,watchSeat:spectator?.seat??null,spectatorCount:(g.spectators??[]).filter(s=>now-s.seenAt<DOUDIZHU_SPECTATOR_TTL).length,code:g.code,scaledDoubleCaps:g.scaledDoubleCaps===true,doubleOptions:g.phase==="doubling"&&!spectator?[1,2,4].map(m=>doubleOption(r,g,g.players.findIndex(p=>p.userId===who.id),m)):[],isPublic:g.isPublic===true,isOwner:ownerOf(g)===who.id,ownerSeat:g.players.findIndex(p=>p.userId===ownerOf(g)),scoringMode:g.scoringMode??"legacy-rate",beansPerDollar:g.beansPerDollar,baseBeans:g.baseBeans,base:g.base,rate:g.rate,maxLoss:g.maxLoss,version:g.version,phase:g.phase,handId:g.handId,reactions:(g.reactions??[]).filter(e=>Date.now()-e.at<4000),players:g.players.map((p,seat)=>({seat,publicId:member(r,p.userId).publicId,doubleMultiplier:p.doubleMultiplier??1,doubleChosen:p.doubleChosen??false,name:member(r,p.userId).name,self:p.userId===who.id,ready:p.ready,auto:false,count:p.hand.length,...((spectator?seat===spectator.seat:p.userId===who.id||g.phase==="revealing"||g.phase==="finished")?{hand:[...p.hand]}:{}),escrow:p.escrow})),kitty:g.landlord!==null?[...g.kitty]:[],turn:g.turn,deadline:g.deadline,idleDeadline:g.idleDeadline??null,landlord:g.landlord,bid:g.bid,multiplier:g.multiplier,trick:g.trick?structuredClone(g.trick):null,settled:g.settled,result:g.result?structuredClone(g.result):null}:null};
}
export type PublicDoudizhu=ReturnType<typeof publicDoudizhu>;
