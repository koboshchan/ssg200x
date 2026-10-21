const {build}=require("esbuild"),fs=require("fs");
(async()=>{
const out=await build({stdin:{contents:`
import React from "react";import {createRoot} from "react-dom/client";
import Roulette from "./app/roulette-client";import {RouletteBetChips} from "./app/roulette-bet-chips";
const now=Date.now();let counter=0;
const bets=[];
function add(publicId,name,isYou,values,kind,pick,color){for(const value of values)bets.push({id:String(counter++),publicId,name,isYou,color,bet:{kind,pick,amount:value*100}});}
add("you","kobosh",true,[20,50,100],"straight",3);
add("alex","Alex",false,[20,50,100],"straight",6);
add("you","kobosh",true,[5,5,5],"straight",9);
add("martin","Martin",false,[1,1,5,20,50],"red");
add("you","kobosh",true,[1,5,20,50,100],"dozen",1);
add("alex","Alex",false,[20,50,100],"dozen",1);
const room={serverNow:now,casinoLimits:{rouletteMaxTotal:100000},me:{wallet:100000},spins:[],roulette:{round:42,started:now,locksAt:now+3600000,spinsAt:now+3605000,idleAnchor:{atMs:now,phase:.6,vel:.04,slot:0,rel:0,r:.6},spin:null,lastBets:[],history:[],bets}};
function App(){const [_,refresh]=React.useState(0);return <main><header className="preview-header"><div><h1>Roulette chip preview</h1><p>Same clay chips as blackjack. Demo bets only.</p></div><button onClick={()=>{document.documentElement.classList.toggle("dark");refresh(n=>n+1)}}>Light / dark</button></header><section className="examples"><article><h2>Your denominations</h2><RouletteBetChips bets={bets.filter(b=>b.publicId==="you"&&b.bet.pick===3)}/><p>20 + 50 + 100 · original denomination colors</p></article><article><h2>Other player's stack</h2><RouletteBetChips bets={bets.filter(b=>b.publicId==="alex"&&b.bet.pick===6)}/><p>3 chips · $170 total on top</p></article></section><Roulette room={room} busy={false} post={async(path,body)=>{if(body.type==="bet"){add("you","kobosh",true,[body.bet.amount/100],body.bet.kind,body.bet.pick);refresh(n=>n+1)}}}/></main>}
createRoot(document.getElementById("root")).render(<App/>);
`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,outdir:"out",platform:"browser",format:"iife",jsx:"automatic",loader:{".module.css":"local-css"}});
const dir="/home/kit/roulette-chips-preview/";
fs.writeFileSync(dir+"app.js",out.outputFiles.find(f=>f.path.endsWith(".js")).text);
fs.writeFileSync(dir+"app.css",fs.readFileSync("app/globals.css","utf8")+"\n"+out.outputFiles.find(f=>f.path.endsWith(".css")).text+`
main{max-width:1160px;margin:auto;padding:28px 20px}.preview-header{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:28px}.preview-header h1{font-size:26px;margin:0 0 8px}.preview-header p,.examples p{color:var(--muted);font-size:12px}.examples{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:32px}.examples article{background:#215b78;color:white;padding:22px 12px;text-align:center;border-radius:8px}.examples h2{font-size:14px;margin:0 0 28px}.examples p{color:#c8dde8;margin-top:18px}.examples [class*="piles"]{gap:12px}.dark{--paper:#142129;--ink:#e5edf0;--muted:#a2b5bf;--line:#334853}.dark body{background:var(--paper);color:var(--ink)}@media(prefers-color-scheme:dark){:root:not(.dark){--paper:#142129;--ink:#e5edf0;--muted:#a2b5bf;--line:#334853}}@media(max-width:600px){main{padding:20px 10px}.preview-header{align-items:flex-start}.preview-header h1{font-size:20px}.preview-header button{font-size:11px;padding:9px}.examples{gap:8px}.examples p{font-size:10px}.examples article{padding:18px 7px}}
`);
fs.writeFileSync(dir+"index.html",'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Roulette chips preview</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
})();
