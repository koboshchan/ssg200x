import {test} from "node:test";
import assert from "node:assert/strict";
import {verifiedGoogleEmail} from "../lib/google-identity";
const base={passwordEnabled:false,primaryEmailAddressId:"email_1",emailAddresses:[{id:"email_1",emailAddress:"Player@Example.test",verification:{status:"verified"}}]};
for(const provider of ["google","oauth_google"])test(`accepts verified Google email with ${provider}`,()=>{
 assert.equal(verifiedGoogleEmail({...base,externalAccounts:[{provider,emailAddress:"player@example.test"}]}),"player@example.test");
});
test("rejects password accounts, other providers, unverified or unrelated primary email",()=>{
 const user={...base,externalAccounts:[{provider:"oauth_google",emailAddress:"player@example.test"}]};
 assert.equal(verifiedGoogleEmail({...user,passwordEnabled:true}),undefined);
 assert.equal(verifiedGoogleEmail({...user,externalAccounts:[{provider:"github",emailAddress:"player@example.test"}]}),undefined);
 assert.equal(verifiedGoogleEmail({...user,emailAddresses:[{...base.emailAddresses[0],verification:{status:"unverified"}}]}),undefined);
 assert.equal(verifiedGoogleEmail({...user,externalAccounts:[{provider:"google",emailAddress:"other@example.test"}]}),undefined);
 assert.equal(verifiedGoogleEmail(null),undefined);
});

test("trusted server-side admin metadata bypasses Google-only restrictions",()=>{
 assert.equal(verifiedGoogleEmail({...base,passwordEnabled:true,externalAccounts:[],publicMetadata:{role:"admin"}}),"player@example.test");
 assert.equal(verifiedGoogleEmail({...base,passwordEnabled:true,externalAccounts:[],publicMetadata:{role:"player"}}),undefined);
});
