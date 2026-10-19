import {clerkClient} from "@clerk/nextjs/server";
import {z} from "zod";
import {endpoint,parse} from "@/lib/api";
import {ensure} from "@/lib/errors";
import {rateLimit} from "@/lib/store";
export const POST=(request:Request)=>endpoint(request,async who=>{
 ensure(who.admin,"Administrator access required.",403);
 await rateLimit("invite:"+who.id,10);
 const {email}=await parse(request,z.object({email:z.string().trim().email().max(254)}).strict());
 const invite=await(await clerkClient()).invitations.createInvitation({emailAddress:email.toLowerCase(),ignoreExisting:false,notify:true});
 return {sent:true,email:invite.emailAddress};
});
