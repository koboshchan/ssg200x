/**
 * CLI only, never imported by an API. Seed synthetic sandbox demonstration hands.
 * MONGODB_URI=mongodb://127.0.0.1:38627 MONGODB_DB=fakebucks_demo_doudizhu
 * npx tsx tests/doudizhu-video-fixture.ts bomb|rocket|airplane|spring|settlement
 * Then play the printed cards as demo seat 0 via the ordinary guarded demo API.
 */
import {randomUUID} from "node:crypto";
import {pathToFileURL} from "node:url";
import {mutate} from "../lib/store";
import {register} from "../lib/poker";
import {applyDoudizhu,publicDoudizhu,type DoudizhuInput} from "../lib/doudizhu";
import {shuffled} from "../lib/doudizhu-rules";
import {audit} from "../lib/audit";
import {closeDatabase} from "../lib/db";
export const scenarios={
 bomb:["3s","3h","3d","3c"],
 rocket:["X","Y"],
 airplane:["3s","3h","3d","4s","4h","4d","5s","6s"],
 spring:["As"],
 settlement:["As"],
 loss:["As"],
 reveal:[],
 deal:[],
} as const;
export function requireFixtureDatabase(){
 const name=process.env.MONGODB_DB??"",uri=process.env.MONGODB_URI??"";
 if(!(name==="fakebucks_demo_doudizhu"||/^fakebucks_test_[a-zA-Z0-9_]+$/.test(name)))throw Error("Fixture requires explicit isolated fakebucks_test_* or fakebucks_demo_doudizhu DB");
 if(!/^mongodb:\/\/(127\.0\.0\.1|localhost):[0-9]+(?:\/|$|\?)/.test(uri))throw Error("Fixture requires loopback MongoDB URI, never production");
}
export async function seedVideoFixture(scenario:keyof typeof scenarios){
 requireFixtureDatabase();
 if(!Object.hasOwn(scenarios,scenario))throw Error("Unknown fixture scenario");
 const users=["You","Mochi","Dango"].map((name,i)=>({id:"demo-dd-"+i,name,email:"demo"+i+"@invalid.test",admin:i===0}));
 const now=Date.now();
 const {room}=await mutate(r=>{
  if(r.members.some(m=>!users.some(u=>u.id===m.id))||(r.doudizhu??[]).some(g=>g.players.some(p=>!users.some(u=>u.id===p.userId))))throw Error("Fixture refuses non-synthetic members or games");
  for(const g of r.doudizhu??[])for(const p of g.players){const m=r.members.find(m=>m.id===p.userId)!;m.wallet+=p.escrow;}
  r.doudizhu=[];
  users.forEach(u=>register(r,u,now));
  const act=(i:number,data:Partial<DoudizhuInput>)=>applyDoudizhu(r,users[i],{type:"ready",requestId:randomUUID(),requestAt:now,version:r.doudizhu?.[0]?.version,...data} as DoudizhuInput,now);
  act(0,{type:"create",beansPerDollar:3000,maxLoss:10000});
  const g=r.doudizhu![0];act(1,{type:"join",code:g.code});act(2,{type:"join",code:g.code});
  for(let i=0;i<(scenario==="deal"?2:3);i++)act(i,{type:"ready"});
  if(scenario==="deal"||scenario==="reveal"){audit(r,users[0],"doudizhu.test-fixture",g.handId,null,{scenario});return;}
  act(0,{type:"bid",bid:3});for(let i=0;i<3;i++)act(i,{type:"double",doubleMultiplier:1});
  const cards=[...scenarios[scenario]];
  // Sort the remaining deck for reproducible opponent cards. Exclude all played combinations.
  const rest=shuffled().filter(c=>!cards.includes(c as never)).sort();
  g.players[0].hand=scenario==="spring"||scenario==="settlement"?cards:[...cards,rest.shift()!];
  g.players[1].hand=rest.splice(0,17);g.players[2].hand=rest.splice(0,17);
  g.kitty=[];g.trick=null;g.turn=0;g.deadline=now+60000;
  g.players.forEach(p=>{p.auto=false;p.plays=0;});
  if(scenario==="settlement")g.players[1].plays=1; // same final play without spring
  if(scenario==="loss"){g.players[1].hand=["As"];g.players[0].hand=g.players[0].hand.filter(c=>c!=="As");g.players[2].hand=g.players[2].hand.filter(c=>c!=="As");g.turn=1;g.players[0].plays=2;}
  g.version++;
  audit(r,users[0],"doudizhu.test-fixture",g.handId,null,{scenario,isolatedDatabase:process.env.MONGODB_DB});
 });
 return {scenario,seat:scenario==="loss"?1:0,nextAction:scenario==="deal"?{type:"ready",seat:2}:scenario==="reveal"?{type:"bid",bid:3,seat:0}:{type:"play",cards:[...scenarios[scenario]],seat:scenario==="loss"?1:0},play:[...scenarios[scenario]],view:publicDoudizhu(room,users[0])};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.env.MONGODB_DB!=="fakebucks_demo_doudizhu")throw Error("Video CLI requires exactly fakebucks_demo_doudizhu");
 seedVideoFixture(process.argv[2] as keyof typeof scenarios).then(result=>console.log(JSON.stringify(result))).finally(()=>closeDatabase()).catch(e=>{console.error(e);process.exitCode=1;});
}
