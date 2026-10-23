import {createHash} from "node:crypto";
import {readdir,readFile} from "node:fs/promises";
import {execFileSync,spawnSync} from "node:child_process";
import {writeFileSync} from "node:fs";
import {bundleServer} from "./bundle-server.mjs";
import {normalizeCommit} from "../runtime/git-commit.mjs";
let commit=normalizeCommit(process.env.SSG_GIT_COMMIT);
if(commit==="unknown"&&!process.env.SSG_GIT_COMMIT){
 try{commit=normalizeCommit(execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8",stdio:["ignore","pipe","ignore"]}));}catch{}
}
// Hash the actual shipped source, including uncommitted edits and Docker builds
// without .git. No environment values, timestamps or secrets enter the identifier.
const hash=createHash("sha256");
async function add(path){
 const entries=await readdir(path,{withFileTypes:true});
 for(const entry of entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
  const name=path+"/"+entry.name;
  if(entry.isDirectory())await add(name);
  else if(entry.isFile()){hash.update(name+"\0");hash.update(await readFile(name));hash.update("\0");}
 }
}
for(const dir of ["app","lib","runtime","public","types","scripts"])await add(dir);
for(const file of ["server.mjs","next.config.ts","proxy.ts","instrumentation.ts","package.json","package-lock.json","tsconfig.json"]){
 hash.update(file+"\0");hash.update(await readFile(file));hash.update("\0");
}
const release=hash.digest("hex");
console.log("Building release "+release);
const result=spawnSync(process.execPath,["node_modules/next/dist/bin/next","build","--webpack"],{
 stdio:"inherit",env:{...process.env,SSG_BUILD_RELEASE:release,SSG_GIT_COMMIT:commit}
});
if(result.status===0){writeFileSync(".next/GIT_COMMIT",commit+"\n");await bundleServer();}
process.exit(result.status??1);
