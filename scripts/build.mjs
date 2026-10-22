import {execFileSync,spawnSync} from "node:child_process";
import {writeFileSync} from "node:fs";
import {normalizeCommit} from "../runtime/git-commit.mjs";
let commit=normalizeCommit(process.env.SSG_GIT_COMMIT);
if(commit==="unknown"&&!process.env.SSG_GIT_COMMIT){
 try{commit=normalizeCommit(execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8",stdio:["ignore","pipe","ignore"]}));}catch{}
}
const result=spawnSync(process.execPath,["node_modules/next/dist/bin/next","build","--webpack"],{stdio:"inherit",env:{...process.env,SSG_GIT_COMMIT:commit}});
if(result.status===0)writeFileSync(".next/GIT_COMMIT",commit+"\n");
process.exit(result.status??1);
