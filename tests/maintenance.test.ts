import test from "node:test";
import assert from "node:assert/strict";
import {maintenancePolicy} from "../lib/maintenance-policy";
test("backfill gates non-admins automatically and lifts on completion",()=>{
 assert.equal(maintenancePolicy(false,false,true).blocked,true);
 assert.equal(maintenancePolicy(false,false,false).blocked,false);
});
test("admin bypasses manual and automatic maintenance",()=>{
 for(const manual of [false,true])for(const backfill of [false,true])assert.equal(maintenancePolicy(true,manual,backfill).blocked,false);
});
test("manual maintenance persists after backfill and cannot defeat active backfill",()=>{
 assert.equal(maintenancePolicy(false,true,false).blocked,true);
 assert.equal(maintenancePolicy(false,false,true).blocked,true);
 assert.equal(maintenancePolicy(false,false,false).active,false);
});
