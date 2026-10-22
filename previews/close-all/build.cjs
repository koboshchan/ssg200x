const esbuild=require("esbuild");
const path=require("node:path");
esbuild.build({entryPoints:[path.join(__dirname,"client.tsx")],outfile:path.join(__dirname,"client.js"),bundle:true,jsx:"automatic",platform:"browser",define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"fixture-live",setup(b){
 b.onResolve({filter:/live-provider$/},()=>({path:"live",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:'export const useLive=()=>({connection:"connected",subscribe:()=>()=>{},emit:()=>{}});'}));
 b.onResolve({filter:/cached-chart$/},()=>({path:"chart",namespace:"chart"}));b.onLoad({filter:/.*/,namespace:"chart"},()=>({contents:'export default function Chart(){return null}'}));
} }],tsconfig:path.join(__dirname,"../../tsconfig.json")}).catch(e=>{console.error(e);process.exit(1)});
