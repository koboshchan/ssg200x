import test from 'node:test';
import assert from 'node:assert/strict';
import {pokerKickDemoEnabled} from '../lib/poker-kick-demo';
const qa={QA_GOOGLE_ADAPTER:'1',CLERK_SECRET_KEY:'sk_test_demo',MONGODB_DB:'ssg_tables_qa',APP_ORIGIN:'https://warmly-vocally-versatile-cuckoo.kitten.space',MONGODB_URI:'mongodb://127.0.0.1:27017/ssg_tables_qa'};
test('demo trigger requires all independent disposable QA guards',()=>{
 assert.equal(pokerKickDemoEnabled(qa),true);
 for(const key of Object.keys(qa))assert.equal(pokerKickDemoEnabled({...qa,[key]:''}),false,key);
 assert.equal(pokerKickDemoEnabled({...qa,CLERK_SECRET_KEY:'sk_live_secret'}),false);
 assert.equal(pokerKickDemoEnabled({...qa,MONGODB_URI:'mongodb://prod:27017'}),false);
 assert.equal(pokerKickDemoEnabled({NODE_ENV:'production',NEXT_PUBLIC_POKER_KICK_DEMO:'1'}),false);
});
