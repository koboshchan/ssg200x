import {mutate,visit} from "./store";
import {register} from "./poker";
import {applyDoudizhu,publicDoudizhu,type DoudizhuInput} from "./doudizhu";
import type {Identity} from "./types";
export async function doudizhuMove(who:Identity,input:DoudizhuInput){
 const {room}=await mutate(r=>{register(r,who);applyDoudizhu(r,who,input);});
 return publicDoudizhu(room,who);
}
export async function doudizhuRead(who:Identity,code?:string){return publicDoudizhu(await visit(who),who,code);}
