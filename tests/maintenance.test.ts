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
test("persistent background choice lifts only the automatic gate; manual maintenance can still close",()=>{
 for(const admin of [true,false]){
  const open=maintenancePolicy(admin,false,true,true);
  assert.equal(open.active,false);assert.equal(open.blocked,false);
  assert.equal(open.backfill,true);assert.equal(open.background,true);
  const closed=maintenancePolicy(admin,true,true,true);
  assert.equal(closed.active,true);assert.equal(closed.blocked,!admin);
 }
});
