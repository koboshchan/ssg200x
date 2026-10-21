import {randomInt,randomUUID} from "node:crypto";
import {wordlist} from "@scure/bip39/wordlists/english.js";
import {classify,beats,rank,shuffled,type Combo} from "./doudizhu-rules";
import {ensure} from "./errors";
import {audit} from "./audit";
import type {Room,Identity} from "./types";
export type DoudizhuInput={type:"create"|"join"|"ready"|"bid"|"play"|"pass"|"leave";code?:string;beansPerDollar?:number;maxLoss?:number;cards?:string[];bid?:number;requestId:string;requestAt:number;version?:number};
export type DoudizhuPlayer={userId:string;ready:boolean;auto:boolean;hand:string[];escrow:number;plays:number};
export type DoudizhuRoom={code:string;base?:number;rate?:number;scoringMode?:"beans"|"legacy-rate";beansPerDollar?:number;baseBeans?:number;maxLoss:number;version:number;phase:"waiting"|"bidding"|"playing"|"finished";handId:string;players:DoudizhuPlayer[];kitty:string[];turn:number;deadline:number|null;landlord:number|null;bid:number;bidder:number|null;bids:number;multiplier:number;trick:{cards:string[];combo:Combo;seat:number}|null;passes:number;settled:boolean;result:null|{winner:number;spring:boolean;unit:number;unitBeans?:number;beanDeltas?:number[];deltas:number[];settlementId:string}};
export const DOUDIZHU_TURN_MS=60_000;
export const DOUDIZHU_RULES={turnMs:DOUDIZHU_TURN_MS,description:"Happy Beans: 1000 base beans times bid and multiplier. Convert beans to cents by flooring beans × 100 / beansPerDollar before caps. Result bean deltas are exact settled cents × beansPerDollar / 100, including fractional beans. Each player reserves the room maximum loss. Bids, bombs, rocket and spring multiply points. Loss cannot exceed reserved chips; a losing landlord pays at most their reserve, split equally between farmers with an odd cent to the lower seat."};
export function doudizhuMaxRate(r:Room){return Number.isSafeInteger(r.doudizhuMaxRate)&&r.doudizhuMaxRate!>=1&&r.doudizhuMaxRate!<=1000000?r.doudizhuMaxRate!:1000;}
export function doudizhuMaxBeansPerDollar(r:Room){return Number.isSafeInteger(r.doudizhuMaxBeansPerDollar)&&r.doudizhuMaxBeansPerDollar!>=1&&r.doudizhuMaxBeansPerDollar!<=1000000000?r.doudizhuMaxBeansPerDollar!:1000000;}
export function doudizhuAssets(r:Room,userId?:string){return (r.doudizhu??[]).reduce((n,g)=>n+g.players.filter(p=>!userId||p.userId===userId).reduce((s,p)=>s+p.escrow,0),0);}
const system:Identity={id:"doudizhu-system",name:"Game timer",email:"",admin:false};
function member(r:Room,id:string){const m=r.members.find(m=>m.id===id);ensure(m,"Account not found.",404);return m;}
function escrow(r:Room,g:DoudizhuRoom,p:DoudizhuPlayer){const m=member(r,p.userId),amount=g.maxLoss;ensure(Number.isSafeInteger(amount)&&m.wallet>=amount,"Insufficient wallet for maximum-loss reserve.");m.wallet-=amount;p.escrow=amount;}
function deal(g:DoudizhuRoom,now:number){const deck=shuffled();ensure(deck.length===54&&new Set(deck).size===54,"Invalid deck.",500);g.handId=randomUUID();g.players.forEach((p,i)=>{p.hand=deck.slice(i*17,i*17+17);p.plays=0;});g.kitty=deck.slice(51);g.phase="bidding";g.turn=0;g.deadline=now+DOUDIZHU_TURN_MS;g.bid=0;g.bidder=null;g.bids=0;g.multiplier=1;g.trick=null;g.passes=0;g.landlord=null;g.settled=false;g.result=null;}
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
 if(landlordWon){for(const i of farmers){const loss=Math.min(unit,g.players[i].escrow);deltas[i]=-loss;deltas[landlord]+=loss;}}
 else{const total=Math.min(unit*2,g.players[landlord].escrow),share=Math.floor(total/2);deltas[landlord]=-total;farmers.forEach((i,n)=>deltas[i]=share+(n===0?total%2:0));}
 const settlementId=g.handId+":settlement";
 g.players.forEach((p,i)=>{ensure(Number.isSafeInteger(p.escrow+deltas[i])&&p.escrow+deltas[i]>=0,"Invalid settlement.",500);member(r,p.userId).wallet+=p.escrow+deltas[i];p.escrow=0;p.ready=false;});
 g.settled=true;g.phase="finished";g.deadline=null;g.result={winner,spring,unit,deltas,settlementId,...(isBeans?{unitBeans,beanDeltas:deltas.map(c=>c*g.beansPerDollar!/100)}:{})};
 audit(r,system,"doudizhu.settlement",settlementId,null,{handId:g.handId,code:g.code,...g.result,at:now});
}
function action(r:Room,g:DoudizhuRoom,seat:number,type:"bid"|"play"|"pass",input:Partial<DoudizhuInput>,now:number){
 ensure(g.turn===seat,"Not your turn.",409);
 if(type==="bid"){
  ensure(g.phase==="bidding","Not bidding.",409);const bid=input.bid;
  ensure(Number.isInteger(bid)&&bid!>=0&&bid!<=3&&(bid===0||bid!>g.bid),"Bid must pass or raise to 1, 2 or 3.");
  g.bids++;if(bid){g.bid=bid;g.bidder=seat;}
  if(bid===3||g.bids===3){if(g.bidder===null){deal(g,now);return;}g.landlord=g.bidder;g.players[g.landlord].hand.push(...g.kitty);g.phase="playing";g.turn=g.landlord;}
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
   if(!p.hand.length){settle(r,g,seat,now);return;}g.turn=(seat+1)%3;
  }
 }
 g.deadline=now+DOUDIZHU_TURN_MS;
}
export function doudizhuNeedsTick(r:Room,now:number){return (r.doudizhu??[]).some(g=>(g.phase==="bidding"||g.phase==="playing")&&g.deadline!==null&&(now>=g.deadline||g.players[g.turn].auto));}
export function tickDoudizhu(r:Room,now:number){let changed=false;for(const g of r.doudizhu??[]){
 if((g.phase==="bidding"||g.phase==="playing")&&g.deadline!==null&&(now>=g.deadline||g.players[g.turn].auto)){
 const p=g.players[g.turn];if(g.phase==="bidding")action(r,g,g.turn,"bid",{bid:0},now);
 else if(g.trick)action(r,g,g.turn,"pass",{},now);
 else action(r,g,g.turn,"play",{cards:[[...p.hand].sort((a,b)=>rank(a)-rank(b)||a.localeCompare(b))[0]]},now);
 g.version++;changed=true;
 }}return changed;}
export function applyDoudizhu(r:Room,who:Identity,input:DoudizhuInput,now=Date.now()){
 ensure(input&&typeof input.requestId==="string"&&/^[a-zA-Z0-9_-]{8,128}$/.test(input.requestId),"Invalid request ID.");
 ensure(Number.isSafeInteger(input.requestAt)&&now-input.requestAt>=-10_000&&now-input.requestAt<=120_000,"Request expired.",409);
 const receipt=(r.doudizhuReceipts??[]).find(x=>x.id===input.requestId);
 if(receipt){ensure(receipt.userId===who.id,"Invalid request.",409);return;}
 const retained=(r.doudizhuReceipts??[]).filter(x=>now-x.at<300_000);ensure(retained.length<4096,"Too many recent moves. Try again shortly.",429);
 const m=member(r,who.id);ensure(m.approved&&!m.accessRevoked,"Access denied.",403);
 const games=r.doudizhu??=[];let own=games.find(g=>g.players.some(p=>p.userId===who.id));
 const code=typeof input.code==="string"?input.code.trim().toLowerCase().replace(/[\s-]+/g," "):"";
 let g: DoudizhuRoom|undefined=code?games.find(g=>g.code===code):own;
 if(input.type==="create"){
  ensure(!own,"Leave your existing room first.",409);ensure(!("rate" in input),"New rooms use beansPerDollar, not rate.");const beansPerDollar=input.beansPerDollar??1000,maxLoss=input.maxLoss??10000;ensure(Number.isSafeInteger(beansPerDollar)&&beansPerDollar>=1&&beansPerDollar<=doudizhuMaxBeansPerDollar(r),"Beans per dollar exceeds the current admin maximum.");ensure(Number.isSafeInteger(maxLoss)&&maxLoss>=100&&maxLoss<=100000000,"Maximum loss must be 100 to 100000000 cents.");
  let newCode:string;do{newCode=Array.from({length:3},()=>wordlist[randomInt(wordlist.length)]).join(" ");}while(games.some(g=>g.code===newCode));
  ensure(games.length<200,"Too many rooms.",409);
  g={code:newCode,scoringMode:"beans",beansPerDollar,baseBeans:1000,maxLoss,version:0,phase:"waiting",handId:randomUUID(),players:[],kitty:[],turn:0,deadline:null,landlord:null,bid:0,bidder:null,bids:0,multiplier:1,trick:null,passes:0,settled:false,result:null};games.push(g);
  const p:DoudizhuPlayer={userId:who.id,ready:false,auto:false,hand:[],escrow:0,plays:0};escrow(r,g,p);g.players.push(p);
 }else{
  ensure(g,"Room not found.",404);const seat=g.players.findIndex(p=>p.userId===who.id);
  if(input.type==="join"){ensure(!own,"Leave your existing room first.",409);ensure(g.phase==="waiting"&&g.players.length<3,"Room is full or started.",409);const p:DoudizhuPlayer={userId:who.id,ready:false,auto:false,hand:[],escrow:0,plays:0};escrow(r,g,p);g.players.push(p);
  }else{
   ensure(seat>=0,"Join this room first.",403);
   if(input.type==="leave"){
    if(g.phase==="bidding"||g.phase==="playing")g.players[seat].auto=true;
    else{m.wallet+=g.players[seat].escrow;g.players.splice(seat,1);if(!g.players.length)r.doudizhu=games.filter(x=>x!==g);}
   }else{
    ensure(Number.isSafeInteger(input.version)&&input.version===g.version,"The turn changed. Refresh first.",409);
    if(input.type==="ready"){
     ensure(g.phase==="waiting"||g.phase==="finished","Hand already started.",409);
     if(g.phase==="finished"){g.phase="waiting";g.players.forEach(p=>{p.auto=false;p.hand=[];});}
     const p=g.players[seat];ensure(!p.ready,"Already ready.",409);if(!p.escrow)escrow(r,g,p);p.ready=true;
     if(g.players.length===3&&g.players.every(p=>p.ready))deal(g,now);
    }else{
     ensure(!g.players[seat].auto,"Automatic play enabled.",409);
     ensure(g.deadline!==null&&now<g.deadline,"Turn expired.",409);
     ensure(["bid","play","pass"].includes(input.type),"Invalid move.");
     action(r,g,seat,input.type as "bid"|"play"|"pass",input,now);
    }
   }
  }
 }
 g!.version++;
 audit(r,who,"doudizhu."+input.type,g!.handId,null,{code:g!.code,version:g!.version,requestId:input.requestId});
 r.doudizhuReceipts=[{id:input.requestId,userId:who.id,at:now},...retained];
}
export function publicDoudizhu(r:Room,who:Identity,code?:string){
 const own=(r.doudizhu??[]).find(g=>g.players.some(p=>p.userId===who.id));
 // Codes reveal only the stake preview. Hands and player identities stay private until joining.
 const g=own&&(!code||own.code===code.trim().toLowerCase().replace(/[\s-]+/g," "))?own:undefined;
 const preview=code?(r.doudizhu??[]).find(x=>x.code===code.trim().toLowerCase().replace(/[\s-]+/g," ")):undefined;
 return {preview:preview?{code:preview.code,scoringMode:preview.scoringMode??"legacy-rate",beansPerDollar:preview.beansPerDollar,baseBeans:preview.baseBeans,rate:preview.rate,maxLoss:preview.maxLoss,count:preview.players.length,phase:preview.phase}:null,houseRules:DOUDIZHU_RULES,maxBeansPerDollar:doudizhuMaxBeansPerDollar(r),maxRate:doudizhuMaxRate(r),wallet:r.members.find(m=>m.id===who.id)?.wallet??0,room:g?{code:g.code,scoringMode:g.scoringMode??"legacy-rate",beansPerDollar:g.beansPerDollar,baseBeans:g.baseBeans,base:g.base,rate:g.rate,maxLoss:g.maxLoss,version:g.version,phase:g.phase,handId:g.handId,players:g.players.map((p,seat)=>({seat,name:member(r,p.userId).name,self:p.userId===who.id,ready:p.ready,auto:p.auto,count:p.hand.length,...(p.userId===who.id?{hand:[...p.hand]}:{}),escrow:p.escrow})),kitty:g.landlord!==null?[...g.kitty]:[],turn:g.turn,deadline:g.deadline,landlord:g.landlord,bid:g.bid,multiplier:g.multiplier,trick:g.trick?structuredClone(g.trick):null,settled:g.settled,result:g.result?structuredClone(g.result):null}:null};
}
export type PublicDoudizhu=ReturnType<typeof publicDoudizhu>;
