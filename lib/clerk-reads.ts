import {createClerkClient} from "@clerk/backend";
import {clerkKeys} from "./clerk-env";
import {clerkReads} from "../runtime/clerk-reads.mjs";
// Route bundles can have separate module caches; share one SDK client in this process.
const state=globalThis as typeof globalThis & {__ssgClerkBackend?:ReturnType<typeof createClerkClient>};
export function backendClerk(){
 return state.__ssgClerkBackend??=createClerkClient(clerkKeys()!);
}
export function currentClerkUser(id:string){
 const clerk=backendClerk();return clerkReads(clerk).user(clerk,id);
}
export async function currentClerkSession(id:string,userId:string){
 const clerk=backendClerk(),session=await clerkReads(clerk).session(clerk,id);
 if(session.status!=="active"||session.userId!==userId)throw Error("session");
}
