type GoogleUser = {
 passwordEnabled: boolean;
 privateMetadata?:{admin?:unknown};
 externalAccounts: {provider:string;emailAddress?:string}[];
 primaryEmailAddressId:string|null;
 emailAddresses:{id:string;emailAddress:string;verification?:{status:string}|null}[];
};
export function verifiedGoogleEmail(user:GoogleUser|null):string|undefined {
 if(!user)return;
 if(user.privateMetadata?.admin===true)return user.emailAddresses.find(e=>e.id===user.primaryEmailAddressId)?.emailAddress.toLowerCase();
 if(user.passwordEnabled)return;
 const accounts=user.externalAccounts.filter(a=>a.provider==="google"||a.provider==="oauth_google");
 if(!accounts.length)return;
 const email=user.emailAddresses.find(e=>e.id===user.primaryEmailAddressId&&e.verification?.status==="verified")?.emailAddress.toLowerCase();
 if(!email||!accounts.some(a=>a.emailAddress?.toLowerCase()===email))return;
 return email;
}
