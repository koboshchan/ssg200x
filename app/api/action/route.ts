import {endpoint,parse} from "@/lib/api";
import {move} from "@/lib/store";
import {publicRoom} from "@/lib/public";
import {actionSchema} from "@/lib/schemas";
export async function POST(request:Request){return endpoint(request,async who=>{const {requestId,handNumber,turnDeadline,requestAt,...action}=await parse(request,actionSchema);return publicRoom(await move(who,action,requestId,handNumber,turnDeadline,requestAt),who);});}
