import {build} from "esbuild";
import {fileURLToPath} from "node:url";
const here=p=>fileURLToPath(new URL(p,import.meta.url)),root=here("../../");
const fixtures={"lib/api":"fixture-api.ts","lib/server-names":"fixture-server-names.ts"};
const plugin={name:"fx",setup(b){
 b.onResolve({filter:/^@\/lib\/(api|server-names)$/},a=>({path:here(fixtures[a.path.slice(2)])}));
 b.onResolve({filter:/^\.\/(api|server-names)$/},a=>{const dir=a.resolveDir;return dir.endsWith("/lib")?{path:here(fixtures["lib/"+a.path.slice(2)])}:undefined;});
 b.onResolve({filter:/^next\/server$/},()=>({path:here("next-server-stub.ts")}));
}};
await build({entryPoints:{routes:here("routes.ts")},outdir:here("dist"),bundle:true,platform:"node",format:"esm",target:"node22",packages:"external",plugins:[plugin],outExtension:{".js":".mjs"},logLevel:"info",tsconfig:root+"tsconfig.json"});
