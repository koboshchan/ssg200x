import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error runtime module
import {createTabLeases} from '../runtime/tab-leases.mjs';
// @ts-expect-error runtime module
import {createTabLeaseDiagnostics,tabLeaseDiagnosticsEnabled} from '../runtime/tab-lease-diagnostics.mjs';
const env={SSG_QA_LEASE_DIAGNOSTICS:'1',SSG_ISOLATED_QA:'1',QA_PROTECTED_COLLECTIONS:'candles',CLERK_PUBLISHABLE_KEY:'pk_test_'+Buffer.from('qa-lease.clerk.accounts.dev$').toString('base64'),CLERK_SECRET_KEY:'sk_test_abcdefghijklmnop'};
const id=(n:number)=>n.toString(16).padStart(48,'0');
const auth={tabId:id(1),tabProof:id(2),route:'/roulette'};
class Socket {connected=true;handlers=new Map<string,Function>();emit(){}on(e:string,f:Function){this.handlers.set(e,f);}disconnect(){this.connected=false;this.handlers.get('disconnect')?.('server namespace disconnect');}report(){this.handlers.get('tab:report')?.({route:'/roulette'});}}
test('explicit isolated DEV only, production/default/invalid keys never emit',()=>{
 assert.equal(tabLeaseDiagnosticsEnabled(env),true);
 for(const changes of [{SSG_QA_LEASE_DIAGNOSTICS:undefined},{SSG_ISOLATED_QA:undefined},{QA_PROTECTED_COLLECTIONS:'other'},{CLERK_SECRET_KEY:'sk_live_secret'},{CLERK_PUBLISHABLE_KEY:'pk_live_secret'},{CLERK_PUBLISHABLE_KEY:'pk_test_invalid'}]){
  assert.equal(createTabLeaseDiagnostics({env:{...env,...changes},write:()=>assert.fail('disabled diagnostics emitted')}),undefined);
 }
 assert.equal(createTabLeaseDiagnostics({env:{}}),undefined);
});
test('missing, proof, socket and request-time expiry remain rejected with safe reasons',()=>{
 let time=0;const lines:string[]=[];
 const diagnostic=createTabLeaseDiagnostics({env,write:(line:string)=>lines.push(line)});
 const l=createTabLeases({now:()=>time,diagnostics:diagnostic}),s=new Socket();
 const check=(proof=auth.tabProof)=>l.check('private-user',auth.tabId,proof,'roulette');
 assert.match(check(),/Reconnect/);l.attach('private-user',s,auth);
 assert.match(check(id(99)),/Reconnect/);s.connected=false;assert.match(check(),/Reconnect/);s.connected=true;
 time=5000;s.report();assert.equal(check(),null);
 time=21000;assert.match(check(),/Reconnect/);assert.equal(s.connected,false);
 const events=lines.map(x=>JSON.parse(x));
 assert.deepEqual(events.filter(x=>x.event==='rejected').map(x=>x.reason),['missing','proof','socket','expired']);
 assert.ok(events.some(x=>x.event==='expired'&&x.ageMs===16000));
 assert.ok(events.some(x=>x.event==='disconnected'&&x.reason==='server_disconnect'));
 const output=lines.join('\n');for(const secret of ['private-user',auth.tabId,auth.tabProof,id(99),env.CLERK_SECRET_KEY,env.CLERK_PUBLISHABLE_KEY])assert.equal(output.includes(secret),false);
});
test('periodic expiry evidence precedes missing rejection and late reports cannot restore lease',()=>{
 let time=0;const events:any[]=[];const l=createTabLeases({now:()=>time,diagnostics:(e:any)=>events.push(e)}),s=new Socket();
 l.attach('u',s,auth);time=16000;l.sweepAll();s.report();assert.match(l.check('u',auth.tabId,auth.tabProof,'roulette'),/Reconnect/);
 assert.ok(events.some(e=>e.event==='expired'));assert.equal(events.at(-1).reason,'missing');
 const next=new Socket();l.attach('u',next,auth);assert.equal(l.check('u',auth.tabId,auth.tabProof,'roulette'),null);
});
test('logging failures never affect guard results; serialization drops unknown fields and raw reasons',()=>{
 const diagnostic=createTabLeaseDiagnostics({env,write:()=>{throw Error('sink failed');}});
 const l=createTabLeases({diagnostics:diagnostic}),s=new Socket();l.attach('u',s,auth);assert.equal(l.check('u',auth.tabId,auth.tabProof,'roulette'),null);
 const lines:string[]=[];createTabLeaseDiagnostics({env,write:(x:string)=>lines.push(x)})({event:'rejected',at:1,reason:'secret raw disconnect',token:'secret',user:'secret',lease:1});
 assert.equal(lines[0].includes('secret'),false);
});
