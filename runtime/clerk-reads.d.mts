import type {ClerkClient,User,Session} from "@clerk/backend";
import type {ClerkProfile} from "./clerk-names.mjs";
type ProfileClient={users:{getUserList(params:{userId:string[];limit:number}):Promise<{data:ClerkProfile[]}>}};
export type ClerkReads={
 user(clerk:Pick<ClerkClient,"users">,id:string):Promise<User>;
 session(clerk:Pick<ClerkClient,"sessions">,id:string):Promise<Session>;
 profiles(clerk:ProfileClient,ids:string[]):Promise<(ClerkProfile|null)[]>;
};
export function createClerkReads(options?:{now?:()=>number;sleep?:(ms:number)=>Promise<void>;ttl?:number;capacity?:number}):ClerkReads;
export function clerkReads(clerk:object):ClerkReads;
