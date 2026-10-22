import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createServer} from "node:http";
import {normalizeCommit,commitStatus,serveCommit} from "../runtime/git-commit.mjs";
const sha="a".repeat(40);
test("commit metadata validates full hashes and compares full identifiers",()=>{
 assert.equal(normalizeCommit(sha+"\n"),sha);
 for(const value of [null,{},sha.slice(0,7),"unknown","<script>"])assert.equal(normalizeCommit(value),"unknown");
 assert.equal(commitStatus(sha,sha),"Commits match");
 assert.equal(commitStatus(sha,"a".repeat(39)+"b"),"Commit mismatch");
 assert.equal(commitStatus(sha,null),"Version unavailable");
});
test("version endpoint is uncached, read-only, and handles unknown metadata",async()=>{
 const server=createServer((req,res)=>{if(!serveCommit(req,res,sha))res.writeHead(404).end();});
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const address=server.address() as {port:number},url="http://127.0.0.1:"+address.port+"/api/version";
 try{
  const result=await fetch(url+"?probe=1");assert.match(result.headers.get("cache-control")!,/no-store/);assert.deepEqual(await result.json(),{commit:sha});
  assert.equal((await fetch(url,{method:"POST"})).status,405);
  assert.equal(await (await fetch(url,{method:"HEAD"})).text(),"");
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test("image bakes github SHA into client and immutable server artifact",()=>{
 const file=(name:string)=>readFileSync(name,"utf8");
 assert.match(file(".github/workflows/docker-publish.yml"),/SSG_GIT_COMMIT=\$\{\{ github.sha \}\}/);
 assert.match(file("Dockerfile"),/ARG SSG_GIT_COMMIT=unknown/);
 assert.match(file("Dockerfile"),/\/app\/\.next\/GIT_COMMIT \.\/\.next\/GIT_COMMIT/);
 assert.match(file("next.config.ts"),/NEXT_PUBLIC_SSG_GIT_COMMIT: process.env.SSG_GIT_COMMIT/);
 assert.match(file("scripts/build.mjs"),/writeFileSync\("\.next\/GIT_COMMIT"/);
});
