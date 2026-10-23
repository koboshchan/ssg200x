import {build,version} from 'esbuild';
import {builtinModules} from 'node:module';
import {mkdir,writeFile,cp} from 'node:fs/promises';
// These optional driver/WS integrations are not installed or used by this app.
// Keep their guarded requires intact; never substitute fake implementations.
export const optionalExternals=['supports-color','bufferutil','utf-8-validate','kerberos','@mongodb-js/zstd','@aws-sdk/credential-providers','gcp-metadata','snappy','socks','mongodb-client-encryption'];
export async function bundleServer(){
 await mkdir('dist',{recursive:true});
 const result=await build({entryPoints:['server.mjs'],outfile:'dist/server.mjs',bundle:true,minify:true,platform:'node',format:'esm',target:'node24',metafile:true,logLevel:'info',external:['next',...optionalExternals],
  define:{'import.meta.url':'__sourceURL'},
  banner:{js:'import {createRequire as __createRequire} from "node:module"; import {fileURLToPath as __fileURLToPath} from "node:url"; import {dirname as __pathDirname} from "node:path"; const require=__createRequire(import.meta.url),__filename=__fileURLToPath(import.meta.url),__dirname=__pathDirname(__filename),__sourceURL=new URL("../server.mjs",import.meta.url).href;'}
 });
 const output=result.metafile.outputs['dist/server.mjs'];
 const externals=[...new Set(output.imports.filter(x=>x.external).map(x=>x.path))].sort();
 const builtins=new Set(builtinModules.flatMap(x=>[x,'node:'+x]));
 for(const name of externals)if(!builtins.has(name)&&name!=='next'&&!optionalExternals.includes(name))throw Error('Unreviewed external: '+name);
 if(Object.keys(result.metafile.outputs).length!==1)throw Error('Expected one server JS file');
 for(const name of ['node_modules/socket.io/dist/index.js','node_modules/accepts/index.js','node_modules/@scure/bip39/wordlists/english.js'])if(!result.metafile.inputs[name])throw Error('Missing bundled dependency '+name);
 // Socket.IO resolves ../client-dist relative to its CJS __dirname. The bundle
 // is in /app/dist, so preserve the existing client-serving API at /app/client-dist.
 await cp('node_modules/socket.io/client-dist','client-dist',{recursive:true});
 await writeFile('dist/server-manifest.json',JSON.stringify({bundler:'esbuild',version,externals,optionalExternals,assets:['client-dist','.next','public'],inputs:Object.keys(result.metafile.inputs)},null,2)+'\n');
 return result;
}
if(process.argv[1]&&new URL('file://'+process.argv[1]).href===import.meta.url)await bundleServer();
