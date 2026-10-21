import {endpoint} from "@/lib/api";
import {ensure} from "@/lib/errors";
import {readRoom} from "@/lib/db";
import {currentNamedRoom} from "@/lib/server-names";
import {adminFingerprintPlayers} from "@/lib/device-fingerprints";
export const dynamic="force-dynamic";
export async function GET(request:Request){
 return endpoint(request,async who=>{
  ensure(who.admin,"Administrator access required.",403);
  const room=await currentNamedRoom(await readRoom());
  return {players:await adminFingerprintPlayers(who,room.members)};
 });
}
