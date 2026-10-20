import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {verifiedGoogleEmail} from "../lib/google-identity";
import {freshRoom,register} from "../lib/poker";
import {publicRoom} from "../lib/public";
// @ts-expect-error Shared custom-server JavaScript runtime.
import {verifiedSocketIdentity} from "../runtime/socket-identity.mjs";
const base={passwordEnabled:false,primaryEmailAddressId:"email",emailAddresses:[{id:"email",emailAddress:"Player@Example.test",verification:{status:"verified"}}],externalAccounts:[{provider:"oauth_google",emailAddress:"player@example.test"}]};
const values=[undefined,null,false,"true","false",1,0,{},[],true];
for(const admin of values)test(`only literal private admin true grants socket admin (${JSON.stringify(admin)})`,()=>{
 const user={...base,privateMetadata:{admin,secret:"never-serialize"},publicMetadata:{role:"admin",admin:true},unsafeMetadata:{admin:true}};
 const identity=verifiedSocketIdentity(user,"player");
 assert.equal(identity?.admin,admin===true);
 assert.equal(verifiedGoogleEmail(user),"player@example.test");
 assert.equal(JSON.stringify(identity).includes("never-serialize"),false);
 const room=freshRoom();register(room,identity);
 const projected=publicRoom(room,identity);
 assert.equal(projected.me.admin,admin===true);
 assert.equal(projected.adminUsers.length,admin===true?1:0);
 assert.equal(JSON.stringify(projected).includes("never-serialize"),false);
 const restricted={...user,passwordEnabled:true,externalAccounts:[]};
 assert.equal(verifiedGoogleEmail(restricted),admin===true?"player@example.test":undefined);
 assert.equal(verifiedSocketIdentity(restricted,"player")?.admin,admin===true?true:undefined);
});
test("missing private metadata ignores public and unsafe metadata plus session-style roles",()=>{
 const user={...base,publicMetadata:{role:"admin",admin:true},unsafeMetadata:{admin:true},role:"admin",admin:true};
 assert.equal(verifiedSocketIdentity(user,"player")?.admin,false);
 assert.equal(verifiedGoogleEmail({...user,passwordEnabled:true}),undefined);
 assert.equal(verifiedSocketIdentity({...user,passwordEnabled:true},"player"),null);
});
test("HTTP, socket, middleware and navigation keep the private admin trust boundary",()=>{
 const read=(file:string)=>readFileSync(new URL("../"+file,import.meta.url),"utf8");
 const api=read("lib/api.ts"),server=read("server.mjs"),proxy=read("proxy.ts"),client=read("app/room-client.tsx");
 assert.match(api,/await currentUser\(\)/);
 assert.match(api,/admin:user\.privateMetadata\?\.admin===true/);
 assert.match(server,/await clerk\.users\.getUser\(claims\.sub\)/);
 assert.match(server,/verifiedSocketIdentity\(user,claims\.sub\)/);
 for(const source of [api,server,proxy,client])assert.doesNotMatch(source,/publicMetadata|unsafeMetadata|sessionClaims/);
 assert.match(proxy,/privateMetadata\?\.admin !== true/); // Admin pages must authorize before rendering.
 assert.doesNotMatch(client,/privateMetadata/);
 assert.match(client,/admin=\{maintenance\?\.admin===true\}/);
});
