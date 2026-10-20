import assert from "node:assert/strict";
import {readFileSync,readdirSync,statSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {NextRequest} from "next/server";
import {clerkConfigured,clerkKeys,clerkPublishableKey,clerkSecretKey} from "../lib/clerk-env";
const names=["CLERK_PUBLISHABLE_KEY","NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY","CLERK_SECRET_KEY"] as const;
function withEnv(values:Partial<Record<typeof names[number],string>>,run:()=>unknown):Promise<void>{
 const saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 for(const n of names)delete process.env[n];
 Object.assign(process.env,values);
 return Promise.resolve().then(run).then(()=>undefined).finally(()=>{for(const n of names){if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];}});
}
const pk="pk_test_runtime",sk="sk_test_runtime";
test("canonical runtime publishable key works without any NEXT_PUBLIC variable",()=>withEnv({CLERK_PUBLISHABLE_KEY:pk,CLERK_SECRET_KEY:sk},()=>{
 assert.equal(clerkPublishableKey(),pk);assert.equal(clerkSecretKey(),sk);
 assert.deepEqual(clerkKeys(),{publishableKey:pk,secretKey:sk});assert.equal(clerkConfigured(),true);
}));
test("legacy runtime NEXT_PUBLIC name is a fallback and the canonical name wins",()=>withEnv({NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:"pk_test_legacy",CLERK_SECRET_KEY:sk},()=>{
 assert.equal(clerkPublishableKey(),"pk_test_legacy");
 process.env.CLERK_PUBLISHABLE_KEY=pk;assert.equal(clerkPublishableKey(),pk);
}));
test("either missing or placeholder key rejects configuration",async()=>{
 await withEnv({CLERK_SECRET_KEY:sk},()=>{assert.equal(clerkKeys(),null);assert.equal(clerkConfigured(),false);});
 await withEnv({CLERK_PUBLISHABLE_KEY:pk},()=>{assert.equal(clerkKeys(),null);assert.equal(clerkConfigured(),false);});
 await withEnv({CLERK_PUBLISHABLE_KEY:"pk_test_REPLACE",CLERK_SECRET_KEY:sk},()=>assert.equal(clerkKeys(),null));
 await withEnv({CLERK_PUBLISHABLE_KEY:pk,CLERK_SECRET_KEY:"sk_test_REPLACE"},()=>assert.equal(clerkKeys(),null));
 await withEnv({CLERK_PUBLISHABLE_KEY:"not-a-key",CLERK_SECRET_KEY:sk},()=>assert.equal(clerkKeys(),null));
});
test("keys are re-read from the environment on every call, never frozen",async()=>{
 await withEnv({},()=>{assert.equal(clerkConfigured(),false);process.env.CLERK_PUBLISHABLE_KEY=pk;process.env.CLERK_SECRET_KEY=sk;assert.equal(clerkConfigured(),true);});
});
test("middleware fails closed on API routes when either key is missing and leaves pages renderable",async()=>{
 const {default:proxy}=await import("../proxy");
 const event={waitUntil(){}} as never;
 for(const env of [{},{CLERK_PUBLISHABLE_KEY:pk},{CLERK_SECRET_KEY:sk}]) await withEnv(env,async()=>{
  const api=(await proxy(new NextRequest("http://localhost/api/room"),event))!;
  assert.equal(api.status,503);assert.deepEqual(await api.json(),{error:"Clerk setup required."});
  assert.equal((await proxy(new NextRequest("http://localhost/leaderboard"),event))!.status,200);
 });
});
test("internal live bypass never needs Clerk keys",()=>withEnv({},async()=>{
 const {default:proxy}=await import("../proxy");
 assert.equal((await proxy(new NextRequest("http://localhost/api/internal-live"),{waitUntil(){}} as never))!.status,200);
}));
test("no source reads a build-time NEXT_PUBLIC Clerk key and every Clerk entry point uses runtime options",()=>{
 const files:string[]=[];
 const walk=(dir:string)=>{for(const name of readdirSync(dir)){if(["node_modules",".next",".git","tests","docs"].includes(name))continue;const p=join(dir,name);statSync(p).isDirectory()?walk(p):/\.(m?[jt]sx?|ya?ml|json)$/.test(name)&&!name.startsWith("package-lock")&&files.push(p);}};
 walk(".");walk(".github");
 const offenders=files.filter(f=>/NEXT_PUBLIC_CLERK/.test(readFileSync(f,"utf8").replace(/"NEXT_PUBLIC_"\+"CLERK_PUBLISHABLE_KEY"/g,"")));
 assert.deepEqual(offenders,[]);
 const read=(p:string)=>readFileSync(p,"utf8");
 assert.match(read("app/layout.tsx"),/<ClerkProvider publishableKey=\{keys\.publishableKey\}>/);
 assert.match(read("app/layout.tsx"),/export const dynamic="force-dynamic"/);
 assert.match(read("proxy.ts"),/clerkMiddleware\([\s\S]*?\}, \(\) => \{[\s\S]*?publishableKey: keys\.publishableKey/);
 assert.doesNotMatch(read("proxy.ts"),/secretKey\s*[:,]/);
 assert.match(read("server.mjs"),/createClerkClient\(\{secretKey:clerkSecretKey,publishableKey:clerkPublishableKey\}\)/);
 assert.match(read("server.mjs"),/verifyToken\(token,\{secretKey:clerkSecretKey,/);
 assert.match(read("lib/server-names.ts"),/createClerkClient\(clerkKeys\(\)!\)/);
});
