import {z} from "zod";
import {endpoint,parse} from "@/lib/api";
import {ensure} from "@/lib/errors";
import {rateLimit} from "@/lib/store";
import {previewAirdrop,confirmAirdrop} from "@/lib/airdrops";
const schema=z.discriminatedUnion("action",[
 z.object({action:z.literal("preview"),amount:z.string().max(32),note:z.string().max(160).optional()}).strict(),
 z.object({action:z.literal("confirm"),previewId:z.string().uuid(),requestId:z.string().uuid()}).strict(),
]);
export const POST=(request:Request)=>endpoint(request,async who=>{
 // endpoint derives this flag from the server Clerk user's privateMetadata.admin === true.
 ensure(who.admin===true,"Administrator access required.",403);await rateLimit("airdrops:"+who.id,20);
 const input=await parse(request,schema);return input.action==="preview"?previewAirdrop(who,input):confirmAirdrop(who,input);
});
