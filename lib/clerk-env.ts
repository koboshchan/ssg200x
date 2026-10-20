// Clerk keys are runtime-only: read from the server environment on every call, never baked into the build.
// Both CLERK_PUBLISHABLE_KEY (canonical) and the legacy NEXT_PUBLIC_ name are accepted at runtime.
// The NEXT_PUBLIC name is read through a computed lookup so Next never inlines it at build time.
const legacy="NEXT_PUBLIC_"+"CLERK_PUBLISHABLE_KEY";
export function clerkPublishableKey():string|undefined {
 const key=(process.env.CLERK_PUBLISHABLE_KEY||process.env[legacy]||"").trim();
 return key.startsWith("pk_")&&!key.includes("REPLACE")?key:undefined;
}
export function clerkSecretKey():string|undefined {
 const key=(process.env.CLERK_SECRET_KEY||"").trim();
 return key.startsWith("sk_")&&!key.includes("REPLACE")?key:undefined;
}
export function clerkKeys():{publishableKey:string;secretKey:string}|null {
 const publishableKey=clerkPublishableKey(),secretKey=clerkSecretKey();
 return publishableKey&&secretKey?{publishableKey,secretKey}:null;
}
export const clerkConfigured=()=>clerkKeys()!==null;
