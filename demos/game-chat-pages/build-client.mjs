import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {mkdirSync,writeFileSync} from "node:fs";
const here=p=>fileURLToPath(new URL(p,import.meta.url)),root=here("../../");
const plugin={name:"fx",setup(b){
 b.onResolve({filter:/^(\.\/|.*\/app\/)live-provider$/},a=>({path:here("fixtures/live-provider.tsx")}));
 b.onResolve({filter:/^@clerk\/nextjs$/},()=>({path:here("fixtures/clerk.tsx")}));
 b.onResolve({filter:/^next\/navigation$/},()=>({path:here("fixtures/next-navigation.ts")}));
 b.onResolve({filter:/^next\/link$/},()=>({path:here("fixtures/next-link.tsx")}));
 b.onResolve({filter:/^next\/dynamic$/},()=>({path:here("fixtures/next-dynamic.tsx")}));
}};
mkdirSync(here("public"),{recursive:true});
await build({entryPoints:{bundle:here("entry.tsx")},outdir:here("public"),bundle:true,minify:false,sourcemap:false,format:"iife",target:"es2022",jsx:"automatic",plugins:[plugin],tsconfig:root+"tsconfig.json",define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"},logLevel:"info",loader:{".svg":"dataurl",".png":"dataurl"}});
writeFileSync(here("public/index.html"),'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Game chat pages (fixture)</title><link rel="stylesheet" href="/bundle.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
