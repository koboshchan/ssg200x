import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
const workflow=readFileSync('.github/workflows/docker-publish.yml','utf8');

test('GHCR publishes main, version tags and manual runs with scoped permissions',()=>{
 assert.match(workflow,/branches: \[main\]/);
 assert.match(workflow,/tags: \['v\*'\]/);
 assert.match(workflow,/workflow_dispatch:/);
 assert.match(workflow,/contents: read\n  packages: write/);
 assert.doesNotMatch(workflow,/pull_request|write-all/);
 assert.match(workflow,/registry: ghcr.io/);
 assert.match(workflow,/password: \$\{\{ secrets.GITHUB_TOKEN \}\}/);
 assert.match(workflow,/images: ghcr.io\/koboshchan\/ssg200x/);
});
test('latest is main-only, release tags are semver and SHA tags are immutable identifiers',()=>{
 assert.match(workflow,/flavor: latest=false/);
 assert.match(workflow,/type=raw,value=latest,enable=\$\{\{ github.ref == 'refs\/heads\/main' \}\}/);
 assert.match(workflow,/type=sha,format=long/);
 assert.match(workflow,/type=semver,pattern=\{\{version\}\}/);
 assert.match(workflow,/type=semver,pattern=\{\{major\}\}.\{\{minor\}\}/);
});
test('all actions are SHA pinned and builds cache without baking private Clerk keys',()=>{
 const actions=[...workflow.matchAll(/uses: ([^\s]+)@([^\s]+)/g)];
 assert.equal(actions.length,5);
 for(const [,name,ref] of actions) assert.match(ref,/^[a-f0-9]{40}$/,name);
 assert.match(workflow,/persist-credentials: false/);
 assert.match(workflow,/cache-from: type=gha/);
 assert.match(workflow,/cache-to: type=gha,mode=max/);
 assert.doesNotMatch(workflow,/CLERK|build-args|sk_live_|pk_test_/i);
 const dockerfile=readFileSync('Dockerfile','utf8');
 assert.equal((dockerfile.match(/^FROM /gm)||[]).length,4);
 assert.match(dockerfile,/FROM deps AS production-deps/);
 assert.match(dockerfile,/npm prune --omit=dev --ignore-scripts/);
 assert.match(dockerfile,/COPY --from=production-deps --chown=node:node \/app\/node_modules/);
 assert.match(dockerfile,/socket\.io.*@clerk\/backend.*mongodb/);
 assert.doesNotMatch(dockerfile,/CLERK_|^ARG /m);
 assert.doesNotMatch(readFileSync('compose.yaml','utf8'),/args:|NEXT_PUBLIC_CLERK/);
});
test('GHCR compose override removes builds and preserves isolated Mongo and runtime settings',()=>{
 const config=JSON.parse(execFileSync('docker',['compose','--env-file','/dev/null','-f','compose.yaml','-f','compose.ghcr.yaml','config','--format','json'],{
  encoding:'utf8',env:{...process.env,CLERK_PUBLISHABLE_KEY:'pk_synthetic',CLERK_SECRET_KEY:'sk_synthetic',APP_ORIGIN:'https://example.invalid',IMAGE_TAG:'sha-test'},
 }));
 assert.equal(config.services.app.image,'ghcr.io/koboshchan/ssg200x:sha-test');
 assert.equal(config.services.app.build,undefined);
 assert.equal(config.services.app.environment.MONGODB_URI,'mongodb://mongo:27017/?replicaSet=rs0&directConnection=true');
 assert.equal(config.services.app.environment.CLERK_SECRET_KEY,'sk_synthetic');
 assert.equal(config.services.app.environment.CLERK_PUBLISHABLE_KEY,'pk_synthetic');
 assert.equal(config.services.mongo.ports,undefined);
 assert.equal(config.networks.backend.internal,true);
 assert.match(config.services.mongo.volumes[0].source,/\/data\/mongo$/);
});
