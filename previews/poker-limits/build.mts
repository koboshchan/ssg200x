import {writeFileSync,readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {build} from "esbuild";
await build({entryPoints:["previews/poker-limits/client.tsx"],outfile:"/home/kit/poker-max-demo/client.js",bundle:true,format:"iife",platform:"browser",jsx:"automatic",loader:{".module.css":"empty"},plugins:[{name:"isolated-boundaries",setup(b){
 b.onResolve({filter:/^(next\/(dynamic|link|navigation)|@clerk\/nextjs|\.\/(live-provider|chat-dock|maintenance-gate))$/},args=>({path:args.path,namespace:"fixture"}));
 b.onLoad({filter:/.*/,namespace:"fixture"},args=>{
  if(args.path==="next/navigation")return {contents:"export const useRouter=()=>({replace(){}});export const usePathname=()=>'/poker';"};
  if(args.path==="./live-provider")return {contents:"export const useLive=()=>({connection:'connected'});export const useLiveEvent=()=>{};export const ConnectionBadge=()=>null;export default function Provider({children}){return children;}"};
  if(args.path==="@clerk/nextjs")return {contents:"export const useUser=()=>({isLoaded:true,isSignedIn:true,user:{id:'fixture'}});export const UserButton=()=>null;export const SignInButton=({children})=>children;"};
  if(args.path==="next/dynamic")return {contents:"export default ()=>()=>null;"};
  return {contents:"export default function Boundary({children}){return children??null;}"};
 });
}}]});

writeFileSync("/home/kit/poker-max-demo/version.json",JSON.stringify({commit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),bundleSha256:createHash("sha256").update(readFileSync("/home/kit/poker-max-demo/client.js")).digest("hex"),isolated:true}));
