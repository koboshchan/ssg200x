import {clerkDisplayName} from "./clerk-names.mjs";
// Mirrors verifiedGoogleEmail, including its administrator policy.
export function verifiedSocketIdentity(user,id){
 const primary=user.emailAddresses.find(e=>e.id===user.primaryEmailAddressId);
 const admin=user.privateMetadata?.admin===true;
 const email=primary?.emailAddress.toLowerCase();
 if(!email)return null;
 if(!admin&&(user.passwordEnabled||primary.verification?.status!=="verified"||!user.externalAccounts.some(a=>(a.provider==="google"||a.provider==="oauth_google")&&a.emailAddress?.toLowerCase()===email)))return null;
 return {id,name:clerkDisplayName(user),email,admin};
}
