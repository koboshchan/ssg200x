import test from "node:test";
import assert from "node:assert/strict";
import {maintenancePolicy} from "../lib/maintenance-policy";
test("only manual maintenance gates non-admins; administrators retain access",()=>{
 for(const admin of [false,true])for(const manual of [false,true]){
  assert.deepEqual(maintenancePolicy(admin,manual),{active:manual,blocked:!admin&&manual,manual});
 }
});
