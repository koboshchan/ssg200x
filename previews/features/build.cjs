const esbuild=require("esbuild");const path=require("node:path");
esbuild.build({entryPoints:[path.join(__dirname,"client.tsx")],outfile:path.join(__dirname,"client.js"),bundle:true,jsx:"automatic",platform:"browser",define:{"process.env.NODE_ENV":'"production"'},tsconfig:path.join(__dirname,"../../tsconfig.json")}).catch(e=>{console.error(e);process.exit(1)});
