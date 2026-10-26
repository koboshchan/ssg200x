import {roomWithClerkNames} from "../../runtime/clerk-names.mjs";
import type {Room} from "@/lib/types";
const NAMES:Record<string,string>={alice:"Alice",bob:"Bob"};
export async function currentProfiles(ids:string[]){return new Map(ids.map(id=>[id,{name:NAMES[id]||"Player",avatar:null}]));}
export async function currentNamedRoom(room:Room,profiles?:any){return roomWithClerkNames(room,profiles??await currentProfiles(room.members.map(m=>m.id)));}
