// Server-only policy shared by HTTP, socket admission, and live socket renewal.
// Opt-in cannot turn a production Clerk instance into an email-auth instance.
export function isolatedQaEmailEnabled(env=process.env){
 if(env.SSG_QA_EMAIL_AUTH!=="1"||env.SSG_ISOLATED_QA!=="1"||env.QA_PROTECTED_COLLECTIONS!=="candles")return false;
 const publishable=(env.CLERK_PUBLISHABLE_KEY||env["NEXT_PUBLIC_"+"CLERK_PUBLISHABLE_KEY"]||"").trim();
 const secret=(env.CLERK_SECRET_KEY||"").trim();
 if(!/^sk_test_[A-Za-z0-9_-]{16,}$/.test(secret)||!/^pk_test_[A-Za-z0-9+/]+={0,2}$/.test(publishable))return false;
 const encoded=publishable.slice(8),decoded=Buffer.from(encoded,"base64");
 if(decoded.toString("base64").replace(/=+$/,"")!==encoded.replace(/=+$/,""))return false;
 return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.clerk\.accounts\.dev\$$/.test(decoded.toString("utf8"));
}
export function verifiedAccountEmail(user,env=process.env){
 if(!user)return;
 const primary=user.emailAddresses.find(e=>e.id===user.primaryEmailAddressId);
 const email=primary?.emailAddress.toLowerCase();
 // Preserve the existing trusted server-side administrator exception.
 if(user.privateMetadata?.admin===true)return email;
 if(!email||primary.verification?.status!=="verified")return;
 if(isolatedQaEmailEnabled(env))return email;
 if(user.passwordEnabled)return;
 if(!user.externalAccounts.some(a=>(a.provider==="google"||a.provider==="oauth_google")&&a.emailAddress?.toLowerCase()===email))return;
 return email;
}
