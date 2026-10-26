import {execFileSync} from "node:child_process";
import {readFileSync,readdirSync} from "node:fs";
import assert from "node:assert/strict";
for(const args of [[],["--prod-like"]])execFileSync(process.execPath,["scripts/ddz-cap-demo-build.mjs",...args],{stdio:"inherit"});
const live=readFileSync("ddz-cap-demo-public/demo.js","utf8");
const prod=readFileSync("/home/kit/dd-cap-prod-like-public/demo.js","utf8");
for(const label of ["Get thrown egg","Get thrown tomato","Receiver preview (demo only)"]){
 assert(live.includes(label),"demo flag should include "+label);
 assert(!prod.includes(label),"production-like build must eliminate "+label);
}
function scan(dir){for(const ent of readdirSync(dir,{withFileTypes:true})){const path=dir+"/"+ent.name;if(ent.isDirectory())scan(path);else if(/\.[cm]?[jt]sx?$/.test(path))assert(!readFileSync(path,"utf8").includes("ddz-cap-demo-client"),"production app must not import fixture entry");}}
scan("app");scan("lib");
console.log("Receiver preview flag ON/OFF build checks passed; production app has no fixture imports.");
