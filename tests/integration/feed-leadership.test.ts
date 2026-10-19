import {test,after} from "node:test";
import assert from "node:assert/strict";
import {fork,type ChildProcess} from "node:child_process";
import {db,closeDatabase} from "../../lib/db";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw Error("Requires isolated test DB");
process.env.MONGODB_DB+="_feed_processes";
const children:ChildProcess[]=[];
after(async()=>{for(const child of children)child.kill();await(await db()).dropDatabase();await closeDatabase();});
function launch(){return new Promise<{child:ChildProcess;report:{sockets:number;rest:number;owner:string}}>((resolve,reject)=>{
 const child=fork("tests/fixtures/price-process.ts",[],{execArgv:["--import","tsx"],env:process.env,stdio:["ignore","ignore","inherit","ipc"]});children.push(child);
 const timeout=setTimeout(()=>{child.kill();reject(Error("Child timeout"));},15000);
 child.once("error",reject);child.once("message",report=>{clearTimeout(timeout);resolve({child,report:report as never});});
});}
test("three processes and 100 consumer starts each create one upstream socket and one REST request total",async()=>{
 const results=await Promise.all([launch(),launch(),launch()]);
 assert.equal(results.reduce((n,r)=>n+r.report.sockets,0),1);
 assert.equal(results.reduce((n,r)=>n+r.report.rest,0),1);
 const leader=results.find(r=>r.report.sockets===1)!;
 const lease=await(await db()).collection("workers").findOne({_id:"coinbase-feed"} as never);
 assert.equal(lease!.owner,leader.report.owner);
 for(const {child}of results)await new Promise<void>(resolve=>{child.once("exit",()=>resolve());child.send("stop");});
});
