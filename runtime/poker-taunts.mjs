import {validPokerTable,pokerSeats} from "./poker-taunts-table.mjs";
import {chargePokerThrow} from "./poker-throw-payment.mjs";
import {randomUUID,createHash} from "node:crypto";
export const TAUNT_COOLDOWN_MS=4000;
export const POKER_EMOTES=Object.freeze({laugh:{emoji:"😂",label:"Laugh"},cry:{emoji:"😭",label:"Cry"},wow:{emoji:"😮",label:"Wow"},think:{emoji:"🤔",label:"Thinking"},nice:{emoji:"👏",label:"Nice hand"},oops:{emoji:"🙈",label:"Oops"}});
// Effects are ephemeral; only paid throws use the atomic financial outbox.
// One budget per identity across all tables and sockets.
export function createPokerTaunts({collection,auditCollection,io,checkSession,checkTab,enabled=()=>true,now=Date.now}){
 const budgets=new Map();
 function reserve(user){
  const at=now(),previous=budgets.get(user);
  if(previous!==undefined&&at-previous<TAUNT_COOLDOWN_MS)return TAUNT_COOLDOWN_MS-(at-previous);
  if(budgets.size>=4096)for(const [id,time] of budgets)if(at-time>=TAUNT_COOLDOWN_MS)budgets.delete(id);
  if(budgets.size>=4096)return TAUNT_COOLDOWN_MS;
  budgets.set(user,at);return 0;
 }
 return function attach(socket){
  socket.on("poker:taunt",async(payload,ack)=>{
   if(typeof ack!=="function")return;
   if(!enabled()){ack({ok:false,error:"feature_disabled"});return;}
   const user=socket.data.identity.id,retryAfterMs=reserve(user);
   if(retryAfterMs){ack({ok:false,error:"cooldown",retryAfterMs});return;}
   try{
    if(!payload||typeof payload!=="object"||Array.isArray(payload))throw Error("invalid");
    const keys=Object.keys(payload);
    const emote=payload.kind==="emote"&&Object.hasOwn(POKER_EMOTES,payload.value);
    const throwable=typeof payload.requestId==="string"&&/^[a-f0-9-]{36}$/.test(payload.requestId)&&Number.isSafeInteger(payload.requestAt)&&Number.isSafeInteger(payload.expectedPrice)&&payload.kind==="throw"&&["egg","tomato"].includes(payload.value)&&Number.isInteger(payload.target)&&payload.target>=0&&payload.target<12&&typeof payload.targetId==="string"&&/^[a-f0-9]{16}$/.test(payload.targetId);
    if(!(validPokerTable(payload.tableId)&&(emote&&keys.length===3||throwable&&keys.length===8)))throw Error("invalid");
    if((socket.data.pokerTableId||"01")!==payload.tableId)throw Error("tab");
    await checkSession(socket);
    if((socket.data.pokerTableId||"01")!==payload.tableId)throw Error("tab");
    if(checkTab(user,socket.handshake.auth.tabId,socket.handshake.auth.tabProof,"poker"))throw Error("tab");
    const room=await collection.findOne({_id:"main"},{projection:{seats:1,pokerTables:1,"members.id":1,"members.accessRevoked":1,siteMaintenance:1}});
    const publicId=id=>createHash("sha256").update(id).digest("hex").slice(0,16);
    const seats=pokerSeats(room,payload.tableId);
    const source=seats.findIndex(s=>s?.userId===user);
    if(source<0||!room.members?.some(m=>m.id===user&&!m.accessRevoked)||room.siteMaintenance)throw Error("not_seated");
    if(throwable&&(!seats[payload.target]||source===payload.target||publicId(seats[payload.target].userId)!==payload.targetId))throw Error("target");
    if((socket.data.pokerTableId||"01")!==payload.tableId)throw Error("tab");
    await checkSession(socket);
    if((socket.data.pokerTableId||"01")!==payload.tableId)throw Error("tab");
    if(!socket.connected||socket.data.expires<=now())throw Error("session");
    if(checkTab(user,socket.handshake.auth.tabId,socket.handshake.auth.tabProof,"poker"))throw Error("tab");
    if(!enabled())throw Error("feature_disabled");
    let payment;
    if(throwable){
     payment=await chargePokerThrow({collection,auditCollection,user,payload,now,authorize:async()=>{if(!enabled())throw Error("feature_disabled");if((socket.data.pokerTableId||"01")!==payload.tableId)throw Error("tab");
    await checkSession(socket);
    if((socket.data.pokerTableId||"01")!==payload.tableId)throw Error("tab");if(!socket.connected||socket.data.expires<=now())throw Error("session");if(checkTab(user,socket.handshake.auth.tabId,socket.handshake.auth.tabProof,"poker"))throw Error("tab");}});
     if(payment.replayed){ack({ok:true,replayed:true,cost:payment.cost});return;}
    }
    const event={tableId:payload.tableId,id:randomUUID(),at:now(),kind:payload.kind,value:payload.value,source:payment?.source??source,sourceId:publicId(user),...(throwable?{target:payment.target,targetId:payment.targetId}:{})};
    // Only current table viewers receive effects. No persistent snapshot/replay.
    for(const target of io.sockets.sockets.values())if(target.connected&&target.data.expires>now()&&target.data.marketRoute==="/poker"&&(target.data.pokerTableId||"01")===payload.tableId)target.emit("poker:taunt",event);
    ack({ok:true,cooldownMs:TAUNT_COOLDOWN_MS,...(payment?{cost:payment.cost}:{})});
   }catch(error){ack({ok:false,error:["feature_disabled","invalid","tab","not_seated","target","session","expired","cooldown","price_changed","insufficient_funds"].includes(error.message)?error.message:"unavailable"});if(error.message==="session")socket.disconnect(true);}
  });
 };
}
