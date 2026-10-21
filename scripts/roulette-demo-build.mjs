import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const inputs=['runtime/roulette-physics.mjs','runtime/roulette-solver.mjs','runtime/roulette-render.mjs','app/roulette-wheel.tsx','app/roulette.module.css','lib/roulette-physics.ts','scripts/roulette-demo-client.tsx','scripts/roulette-demo.css','scripts/roulette-demo-server.mjs','scripts/roulette-demo-build.mjs','scripts/roulette-preview-target.tsx','scripts/roulette-preview-policy.mjs'];
export function sourceHash(){const h=createHash('sha256');for(const p of inputs)h.update(p+'\0').update(readFileSync(p)).update('\0');return h.digest('hex');}
if(process.argv[1]?.endsWith('roulette-demo-build.mjs')){
 const previewTarget=process.env.NODE_ENV!=='production'&&process.env.NEXT_PUBLIC_ROULETTE_PREVIEW_TARGET==='1';
 const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hash=sourceHash();
 if(execFileSync('git',['status','--porcelain','--',...inputs],{encoding:'utf8'}).trim())throw Error('Commit demo inputs before building');
 mkdirSync('out/roulette-demo',{recursive:true});
 await build({entryPoints:['scripts/roulette-demo-client.tsx'],bundle:true,minify:true,outfile:'out/roulette-demo/app.js',platform:'browser',jsx:'automatic',define:{PREVIEW_TARGET:JSON.stringify(previewTarget),BUILD_SHA:JSON.stringify(sha),SOURCE_HASH:JSON.stringify(hash),'process.env.NODE_ENV':'"production"'}});
 const manifest={previewTarget,commit:sha,sourceHash:hash,inputs,appHash:createHash('sha256').update(readFileSync('out/roulette-demo/app.js')).digest('hex')};
 writeFileSync('out/roulette-demo/manifest.json',JSON.stringify(manifest,null,2));
 writeFileSync('out/roulette-demo/index.html','<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SSG integrated roulette</title><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');
 console.log(JSON.stringify(manifest));
}
