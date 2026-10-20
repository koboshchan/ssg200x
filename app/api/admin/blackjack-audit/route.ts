import {z} from "zod";
import {endpoint} from "@/lib/api";
import {blackjackAudit} from "@/lib/blackjack-audit";
const query=z.object({publicId:z.string().regex(/^[a-f0-9]{16}$/).optional()}).strict();
export const GET=(request:Request)=>endpoint(request,async who=>{
 const {publicId}=query.parse(Object.fromEntries(new URL(request.url).searchParams));
 return blackjackAudit(who,publicId);
});
