import {timingSafeEqual} from "node:crypto";
import {z} from "zod";
export function internalLiveAuthorized(request:Request,secret=process.env.INTERNAL_LIVE_SECRET){
 const supplied=request.headers.get("x-internal-live-secret");
 if(!secret||!supplied)return false;
 const a=Buffer.from(secret),b=Buffer.from(supplied);
 return a.length===b.length&&timingSafeEqual(a,b);
}
export const socketIdentity=z.object({id:z.string().min(1).max(256),name:z.string().min(1).max(256),email:z.string().email(),admin:z.boolean()}).strict();
