import {pokerTableId} from "@/lib/poker-tables";
import {endpoint} from "@/lib/api";
import {visit,tickRoom} from "@/lib/store";
import {freshPublicRoom as publicRoom} from "@/lib/public";
export const dynamic="force-dynamic";
export async function GET(request:Request) {return endpoint(request,async who=>{const tableId=pokerTableId(new URL(request.url).searchParams.get("tableId")??"01");await tickRoom();return publicRoom(await visit(who),who,undefined,tableId);});}
