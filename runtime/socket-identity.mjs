import {clerkDisplayName} from "./clerk-names.mjs";
import {verifiedAccountEmail} from "./account-policy.mjs";
export function verifiedSocketIdentity(user,id,env=process.env){
 const email=verifiedAccountEmail(user,env);
 if(!email)return null;
 return {id,name:clerkDisplayName(user),email,admin:user.privateMetadata?.admin===true};
}
