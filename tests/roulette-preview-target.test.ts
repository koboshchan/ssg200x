import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {choosePreviewTarget} from '../scripts/roulette-preview-policy.mjs';
import {solveLaunch} from '../runtime/roulette-solver.mjs';
import {POCKETS,createTrajectory,PHYS_VERSION} from '../lib/roulette-physics';
import {initialAnchor} from '../lib/roulette';

test('production rejects every target even with both preview flags accidentally enabled',()=>{
 let calls=0;
 for(let target=0;target<=36;target++){
  assert.throws(()=>choosePreviewTarget(String(target),{nodeEnv:'production',enabled:'1',previewBuild:true},()=>{calls++;return 17;}),/unavailable/);
 }
 assert.equal(calls,0);
 assert.equal(choosePreviewTarget(null,{nodeEnv:'production',enabled:'1',previewBuild:true},()=>17)(),17);
});
test('preview requires both server opt-in and preview UI build',()=>{
 for(const config of [{nodeEnv:'development',enabled:'0',previewBuild:true},{nodeEnv:'development',enabled:'1',previewBuild:false}]){
  assert.throws(()=>choosePreviewTarget('3',config,()=>17),/unavailable/);
 }
});
test('preview validates exact integer targets including zero and upper boundary',()=>{
 for(const target of ['', '-1','37','1.5','00',' 3','NaN','Infinity']){
  assert.throws(()=>choosePreviewTarget(target,{nodeEnv:'development',enabled:'1',previewBuild:true},()=>17),/Invalid/);
 }
});
test('preview honors all 37 requested targets and unchanged physics lands in each pocket',()=>{
 let anchor=initialAnchor(0),spinStartAt=60000;
 for(const requested of POCKETS){
  const target=choosePreviewTarget(String(requested),{nodeEnv:'development',enabled:'1',previewBuild:true},()=>{throw Error('Must not randomize override');})();
  assert.equal(target,requested);
  const solved=solveLaunch({target,anchor,spinStartAt,seed:61000+requested});
  const trajectory=createTrajectory({roundId:'target-'+target,target,physicsVersion:PHYS_VERSION,lockDeadline:1,resultGeneratedAt:2,broadcastAt:3,serverNow:3,spinStartAt,idleAnchor:anchor,launchParams:solved.launchParams});
  assert.equal(POCKETS[trajectory.endAnchor.slot],requested);
  anchor=solved.endAnchor;spinStartAt=anchor.atMs+60000;
 }
});
test('production browser bundle completely eliminates preview control and request target code',async()=>{
 const result=await build({entryPoints:['scripts/roulette-demo-client.tsx'],bundle:true,minify:true,outdir:'out/target-bundle-test',write:false,platform:'browser',jsx:'automatic',define:{PREVIEW_TARGET:'false',BUILD_SHA:'"test"',SOURCE_HASH:'"test"','process.env.NODE_ENV':'"production"'}});
 const js=result.outputFiles.find(f=>f.path.endsWith('.js'))?.text||result.outputFiles[0].text;
 assert.doesNotMatch(js,/Next round target|preview-target|\?target=|Must not randomize/);
});
