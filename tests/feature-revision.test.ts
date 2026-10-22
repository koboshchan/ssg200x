import test from "node:test";import assert from "node:assert/strict";
import {createFeatureRevisionObserver} from "../runtime/feature-revision.mjs";
test("banner only after a later higher revision, once",()=>{const seen:number[]=[];const o=createFeatureRevisionObserver(r=>seen.push(r));
o({revision:3});o({revision:3});o({});o({revision:"x"});assert.deepEqual(seen,[]);o({revision:4});o({revision:5});assert.deepEqual(seen,[4]);});
