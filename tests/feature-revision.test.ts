import test from "node:test";import assert from "node:assert/strict";
import {createFeatureRevisionObserver} from "../runtime/feature-revision.mjs";
test("banner only after a later higher revision, once",()=>{const seen:number[]=[];const o=createFeatureRevisionObserver(r=>seen.push(r));
o({revision:3});o({revision:3});o({});o({revision:"x"});assert.deepEqual(seen,[]);o({revision:4});o({revision:5});assert.deepEqual(seen,[4]);});

import {createFeatureRevisionCheck} from "../runtime/feature-revision.mjs";
import {readFileSync} from "node:fs";
test("anonymous polling baselines safely, notices increases and stays latched without reload",async()=>{
 const seen:number[]=[];
 const replies:unknown[]=[null,{revision:"3"},{revision:-1},{revision:1.5},{revision:3},{revision:3},{revision:2},{revision:4},{revision:3},{revision:5}];
 const check=createFeatureRevisionCheck(createFeatureRevisionObserver(r=>seen.push(r)),(async(url,options)=>{
  assert.equal(url,"/api/features");assert.equal(options?.cache,"no-store");
  return Response.json(replies.shift());
 }) as typeof fetch);
 for(let i=0;i<7;i++){await check();assert.deepEqual(seen,[]);}
 await check();assert.deepEqual(seen,[4]);
 await check();await check();assert.deepEqual(seen,[4]);
});
test("failed requests do not baseline; concurrent checks share a request and retry later",async()=>{
 let calls=0;const seen:number[]=[];
 const check=createFeatureRevisionCheck(createFeatureRevisionObserver(r=>seen.push(r)),(async()=>{
  calls++;
  if(calls===1)throw new Error("offline");
  if(calls===2)return new Response("bad",{status:503});
  if(calls===3)return new Response("invalid json");
  return Response.json({revision:calls});
 }) as typeof fetch);
 const first=check();assert.equal(first,check());await first;assert.equal(calls,1);
 await check();await check();await check();assert.deepEqual(seen,[]);
 await check();assert.deepEqual(seen,[5]);
});
test("root provider polls publicly without socket or auth and only reloads on button click",()=>{
 const ui=readFileSync("app/release-provider.tsx","utf8"),layout=readFileSync("app/layout.tsx","utf8");
 assert.match(layout,/<ReleaseProvider><RoomClient/);
 assert.match(ui,/createFeatureRevisionCheck\(observeFeatures\)/);
 assert.match(ui,/Promise\.all\(\[checkFeatures\(\),fetch/);
 assert.match(ui,/setInterval\(visible,15000\)/);
 assert.match(ui,/stale\|\|featuresChanged/);
 assert.match(ui,/onCancel=\{event=>event.preventDefault\(\)\}/);
 assert.equal(ui.match(/window.location.reload\(\)/g)?.length,1);
 assert.match(ui,/onClick=\{\(\)=>window.location.reload\(\)\}/);
 assert.doesNotMatch(ui,/useAuth|useLive|setFeaturesChanged\(false\)/);
});
