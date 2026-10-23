import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
test("release build avoids Turbopack's untraced MongoDB external alias",()=>{
 const pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
 assert.equal(pkg.scripts.build,"node scripts/build.mjs");
 assert.match(readFileSync("scripts/build.mjs","utf8"),/next.dist.bin.next.*"build","--webpack"/);
});
test("standalone tracing wins over custom-server runtime dependencies",()=>{
 const file=readFileSync(new URL("../Dockerfile",import.meta.url),"utf8");
 const production=file.indexOf("COPY --from=production-deps");
 const standalone=file.indexOf("COPY --from=builder --chown=node:node /app/.next/standalone");
 assert.ok(production>=0&&standalone>production);
 assert.equal(file.indexOf("./node_modules",standalone),-1,"do not overwrite traced packages after standalone");
});
test("every Docker entry point pins the October security release",()=>{
 for (const name of ["Dockerfile", "Dockerfile.prebuilt", "compose.dev.yaml"]) {
  const file=readFileSync(new URL(`../${name}`,import.meta.url),"utf8");
  const images=[...file.matchAll(/\bnode:(24[^\s]+)/g)].map(match=>match[1]);
  assert.ok(images.length>0,`${name} must declare a Node image`);
  for (const image of images) assert.match(image,/^24\.22\.1-(bookworm-slim|alpine)$/,`${name} must use a patched, explicit runtime`);
 }
});
test('prebuilt image installs locked production dependencies before traced Next aliases',()=>{
 const file=readFileSync('Dockerfile.prebuilt','utf8');
 assert.match(file,/npm ci --omit=dev --ignore-scripts/);
 assert.ok(file.indexOf('COPY --from=production-deps')<file.indexOf('COPY --chown=node:node .next/standalone'));
 for(const name of ['Dockerfile','Dockerfile.prebuilt'])assert.match(readFileSync(name,'utf8'),/CMD \["node","dist\/server.mjs"\]/);
});
test('custom server bundle includes pure JS dependencies and inventories every external',async()=>{
 const {bundleServer,optionalExternals}=await import(new URL('../scripts/bundle-server.mjs',import.meta.url).href);
 const result=await bundleServer();
 assert.deepEqual(Object.keys(result.metafile.outputs),['dist/server.mjs']);
 const names=Object.keys(result.metafile.inputs);
 for(const name of ['accepts','socket.io','socket.io-adapter','socket.io-parser','engine.io-parser','cors','debug','@clerk/backend','mongodb','@scure/bip39'])assert.ok(names.some(x=>x.startsWith('node_modules/'+name+'/')),name);
 const manifest=JSON.parse(readFileSync('dist/server-manifest.json','utf8'));
 assert.ok(manifest.externals.includes('next'));
 assert.deepEqual(manifest.optionalExternals,optionalExternals);
 assert.ok(!manifest.externals.includes('socket.io'));
 assert.ok(!manifest.externals.includes('@scure/bip39'));
 assert.ok(readFileSync('client-dist/socket.io.js').length>1000);
});

test('prebuilt revision proof survives the strict context allowlist',()=>{
 const dockerfile=readFileSync('Dockerfile.prebuilt','utf8');
 const allowlist=readFileSync('Dockerfile.prebuilt.dockerignore','utf8').split(/\r?\n/);
 assert.ok(allowlist.includes('!.next/GIT_COMMIT'));
 assert.match(dockerfile,/COPY --chown=node:node \.next\/GIT_COMMIT \.\/\.next\/GIT_COMMIT/);
 assert.ok(dockerfile.indexOf('.next/GIT_COMMIT')>dockerfile.indexOf('COPY --chown=node:node .next/standalone'));
});
