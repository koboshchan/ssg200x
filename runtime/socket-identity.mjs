// Mirrors verifiedGoogleEmail, including its administrator policy.
export function verifiedSocketIdentity(user,id){
 const primary=user.emailAddresses.find(e=>e.id===user.primaryEmailAddressId);
 const admin=user.publicMetadata?.role==="admin";
 const email=primary?.emailAddress.toLowerCase();
 if(!email)return null;
 if(!admin&&(user.passwordEnabled||primary.verification?.status!=="verified"||!user.externalAccounts.some(a=>(a.provider==="google"||a.provider==="oauth_google")&&a.emailAddress?.toLowerCase()===email)))return null;
 return {id,name:user.firstName||user.username||"Player",email,admin};
}
