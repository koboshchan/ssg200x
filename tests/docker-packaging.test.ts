import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
test("release build avoids Turbopack's untraced MongoDB external alias",()=>{
 const pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
 assert.equal(pkg.scripts.build,"next build --webpack");
});
test("standalone tracing wins over custom-server runtime dependencies",()=>{
 const file=readFileSync(new URL("../Dockerfile",import.meta.url),"utf8");
 const production=file.indexOf("COPY --from=production-deps");
 const standalone=file.indexOf("COPY --from=builder --chown=node:node /app/.next/standalone");
 assert.ok(production>=0&&standalone>production);
 assert.equal(file.indexOf("./node_modules",standalone),-1,"do not overwrite traced packages after standalone");
});
