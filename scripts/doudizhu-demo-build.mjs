import {build} from "esbuild";
import {execFileSync} from "node:child_process";
import {writeFileSync,mkdirSync} from "node:fs";
const sha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
mkdirSync("demo-public",{recursive:true});
await build({entryPoints:["scripts/doudizhu-demo-client.tsx"],bundle:true,minify:true,outfile:"demo-public/demo.js",platform:"browser",jsx:"automatic",plugins:[{name:"unused-poker-live-hooks",setup(b){b.onResolve({filter:/^\.\/live-provider$/},()=>({path:"unused-live",namespace:"dd-demo"}));b.onLoad({filter:/.*/,namespace:"dd-demo"},()=>({contents:`export function useLive(){throw new Error("Poker-only hook is not available in the Dou Dizhu demo")} export function useLiveEvent(){throw new Error("Poker-only hook is not available in the Dou Dizhu demo")}`,loader:"js"}));}}],define:{"process.env.NODE_ENV":'"production"'},alias:{"@":"."},loader:{".css":"css"}});
writeFileSync("demo-public/index.html",`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="demo-commit" content="${sha}"><title>Dou Dizhu demo</title><link rel="stylesheet" href="/demo.css"></head><body><div id="root"></div><script src="/demo.js"></script></body></html>`);
