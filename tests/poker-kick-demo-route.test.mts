import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
let effects=0;
mock.module('../lib/api.ts',{namedExports:{endpoint:async()=>{effects++;throw Error('auth must not run');},parse:async()=>{effects++;}}});
mock.module('../lib/store.ts',{namedExports:{mutate:async()=>{effects++;throw Error('mutation must not run');}}});
mock.module('../lib/public.ts',{namedExports:{freshPublicRoom:async()=>{effects++;}}});
const {POST}=await import('../app/api/poker-kicks/demo/route');
const qa={QA_GOOGLE_ADAPTER:'1',CLERK_SECRET_KEY:'sk_test_demo',MONGODB_DB:'ssg_tables_qa',APP_ORIGIN:'https://warmly-vocally-versatile-cuckoo.kitten.space',MONGODB_URI:'mongodb://127.0.0.1:27017/ssg_tables_qa'};
test('actual demo endpoint returns 404 before auth or mutation for every missing guard and production case',async()=>{
 const saved={...process.env};
 try{
  for(const patch of [
   ...Object.keys(qa).map(key=>({[key]:''})),
   {CLERK_SECRET_KEY:'sk_live_production'},
   {APP_ORIGIN:'https://ssg200x.com'},
   {MONGODB_DB:'production'},
   {MONGODB_URI:'mongodb://mongo:27017'},
   {MONGODB_URI:'mongodb://127.0.0.1.evil.invalid/'},
  ]){
   Object.assign(process.env,qa,patch,{NODE_ENV:'production',NEXT_PUBLIC_POKER_KICK_DEMO:'1'});
   const response=await POST(new Request('https://ssg200x.com/api/poker-kicks/demo',{method:'POST',body:'{}'}));
   assert.equal(response.status,404,JSON.stringify(patch));
   assert.deepEqual(await response.json(),{error:'Not found.'});
  }
  assert.equal(effects,0);
 }finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
});
