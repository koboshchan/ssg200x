import {build} from "esbuild";
import {execFileSync} from "node:child_process";
import {writeFileSync,mkdirSync,existsSync,copyFileSync} from "node:fs";
const sha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const prodLike=process.argv.includes("--prod-like");
const out=prodLike?"/home/kit/dd-cap-prod-like-public":"ddz-cap-demo-public";
mkdirSync(out,{recursive:true});
await build({entryPoints:["scripts/ddz-cap-demo-client.tsx"],bundle:true,minify:true,outfile:out+"/demo.js",platform:"browser",jsx:"automatic",plugins:[{name:"unused-poker-live-hooks",setup(b){b.onResolve({filter:/^\.\/live-provider$/},()=>({path:"unused-live",namespace:"dd-demo"}));b.onLoad({filter:/.*/,namespace:"dd-demo"},()=>({contents:`export function useLive(){throw new Error("Poker-only hook is not available in this demo")} export function useLiveEvent(){throw new Error("Poker-only hook is not available in this demo")}`,loader:"js"}));}}],define:{"process.env.NODE_ENV":'"production"',"process.env.SSG_DEMO_RECEIVER_PREVIEW":JSON.stringify(prodLike?"0":"1")},alias:{"@":"."},loader:{".css":"css"}});
writeFileSync(out+"/index.html",`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="demo-commit" content="${sha}"><title>isolated SSG demo</title><link rel="stylesheet" href="/demo.css"></head><body><div id="root"></div><script src="/demo.js"></script></body></html>`);
