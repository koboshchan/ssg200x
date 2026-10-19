import {endpoint} from "@/lib/api";
import {visit,tickRoom} from "@/lib/store";
import {publicRoom} from "@/lib/public";
export const dynamic="force-dynamic";
export async function GET(request:Request) {return endpoint(request,async who=>{await tickRoom();return publicRoom(await visit(who),who);});}
