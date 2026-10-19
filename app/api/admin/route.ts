import {endpoint,parse} from "@/lib/api";
import {approve} from "@/lib/store";
import {approvalSchema} from "@/lib/schemas";
import {publicRoom} from "@/lib/public";
export async function POST(request:Request){return endpoint(request,async who=>{const input=await parse(request,approvalSchema);return publicRoom(await approve(who,input.publicId,input.approved),who);});}
