import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync,statSync} from "node:fs";
import {join} from "node:path";
function walk(d:string,out:string[]=[]){for(const n of readdirSync(d)){if(["node_modules",".next",".git","tests"].includes(n))continue;const p=join(d,n);statSync(p).isDirectory()?walk(p,out):/\.(m?tsx?|c?jsx?|mjs|cjs)$/.test(n)&&out.push(p);}return out;}
test("no native alert/confirm/prompt anywhere in the repo (app, lib, scripts, runtime, previews, root)",()=>{
 const bad:string[]=[];
 {const files=walk(".");
  for(const f of files)if(/(^|[^\w.$])(?:window\.|globalThis\.)?(?:alert|confirm|prompt)\s*\(/.test(readFileSync(f,"utf8").replace(/\/\/.*$/gm,"")))bad.push(f);}
 assert.deepEqual(bad,[]);
});
test("kick vote shows tally and needed count",()=>{const k=readFileSync("app/seat-kick.tsx","utf8");assert.match(k,/needed/);assert.match(k,/automatically NO/);});
