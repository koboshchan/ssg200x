import {mutate,visit} from "./store";
import {register} from "./poker";
import {applyDoudizhu,publicDoudizhu,touchDoudizhuSpectator,DOUDIZHU_SPECTATOR_TTL,type DoudizhuInput} from "./doudizhu";
import type {Identity} from "./types";
export async function doudizhuMove(who:Identity,input:DoudizhuInput){
 const {room}=await mutate(r=>{register(r,who);applyDoudizhu(r,who,input);});
 return publicDoudizhu(room,who);
}
export async function doudizhuRead(who:Identity,code?:string){
 let room=await visit(who);const now=Date.now();
 if(room.doudizhu?.some(g=>g.spectators?.some(s=>s.userId===who.id&&now-s.seenAt>=15_000&&now-s.seenAt<DOUDIZHU_SPECTATOR_TTL))){
  room=(await mutate(r=>touchDoudizhuSpectator(r,who.id))).room;
 }
 return publicDoudizhu(room,who,code);
}
