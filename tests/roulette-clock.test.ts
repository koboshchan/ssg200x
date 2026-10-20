import {test} from 'node:test';
import assert from 'node:assert/strict';
import {roulettePhase,phaseDeadline,wheelPose,ambientWheelRotation,WHEEL_POCKETS} from '../lib/roulette-clock';
import {freshRoom,register,assertRoom} from '../lib/poker';
import {rouletteState,rouletteTick,roulettePublic,rouletteAction} from '../lib/roulette';
import {createStateReceiver,emitState} from '../runtime/state-stream.mjs';
const who={id:'a',name:'Alice',email:'a@test.invalid',admin:true};
const spin={round:8,number:7,startedAt:60000,resultAt:72000,nextAt:77000};
const clock={locksAt:55000,spinsAt:60000,spin:null};
test('exact phase boundaries never shorten betting or invent a spin before worker commit',()=>{
 for(const [now,phase] of [[54999,'betting'],[55000,'locked'],[59999,'locked'],[60000,'locked'],[999999,'locked']] as const)assert.equal(roulettePhase(clock,now),phase);
 for(const [now,phase] of [[60000,'spinning'],[71999,'spinning'],[72000,'result'],[76999,'result'],[77000,'result']] as const)assert.equal(roulettePhase({...clock,spin},now),phase);
 assert.equal(phaseDeadline(clock,54999),55000);assert.equal(phaseDeadline(clock,55000),60000);assert.equal(phaseDeadline({...clock,spin},60000),72000);assert.equal(phaseDeadline({...clock,spin},72000),77000);
});
test('late joins, reconnect and duplicate state frames seek identical eased absolute poses',()=>{
 for(const t of [60000,61500,66000,71000,72000,77000])assert.deepEqual(wheelPose({...spin},t),wheelPose(spin,t));
 assert.equal(wheelPose(spin,59000).progress,0);assert.equal(wheelPose(spin,73000).progress,1);
 const end=wheelPose(spin,72000);
 const pocket=WHEEL_POCKETS.indexOf(7)*360/37;
 assert.ok(Math.abs(((end.rotor+pocket)%360))<1e-9);
 assert.ok(wheelPose(spin,61000).rotor>0);assert.ok(wheelPose(spin,71000).rotor-wheelPose(spin,70000).rotor<wheelPose(spin,62000).rotor-wheelPose(spin,61000).rotor);
 assert.deepEqual(wheelPose(spin,65000,true),{...end,progress:5/12});
});
test('delayed worker preserves full spin and pause, never skips or re-rolls completed rounds',()=>{
 const r=freshRoom();register(r,who);rouletteState(r,0);rouletteAction(r,who,{type:'bet',bet:{kind:'red',amount:100}},1,'bet',54999);
 let calls=0;const rng=()=>{calls++;return 1;};rouletteTick(r,120000,rng);
 const b=roulettePublic(r,who,120000)!;assert.equal(b.spin!.startedAt,120000);assert.equal(b.spin!.resultAt,132000);assert.equal(b.spin!.nextAt,137000);
 assert.equal(rouletteTick(r,136999,rng),false);assert.equal(rouletteTick(r,500000,rng),true);assert.equal(roulettePublic(r,who,500000)!.started,500000);assert.equal(calls,1);assertRoom(r);
 assert.equal(rouletteTick(r,500001,rng),false);assert.equal(calls,1);
});
test('full/diff resync preserves one immutable spin anchor and phase clock',()=>{
 const messages:unknown[]=[];const socket={emit:(_event:string,v:unknown)=>messages.push(v)};
 let requests=0;const receiver=createStateReceiver(()=>{requests++;});
 const before={serverNow:60000,roulette:{...clock,spin}},after={serverNow:66000,roulette:{...clock,spin}};
 emitState(socket,'room:state',before,false,60000);emitState(socket,'room:state',after,false,66000);
 const full=receiver.receive('room:state',messages[0]);const diff=receiver.receive('room:state',messages[1]);assert.ok(full.ok&&diff.ok);assert.deepEqual(diff.value,after);
 assert.deepEqual(wheelPose((diff.value as typeof after).roulette.spin,66000),wheelPose(spin,66000));
 assert.equal(receiver.receive('room:state',messages[1]).ok,false);assert.equal(requests,1);
 emitState(socket,'room:state',after,true,66001);assert.deepEqual(receiver.receive('room:state',messages[2]).value,after);
});

test('ambient open clock contains no future result and spin preserves its absolute start',()=>{
 const previous={number:7};const start=1000;
 assert.equal(ambientWheelRotation(start,11000,previous)-ambientWheelRotation(start,1000,previous),1000);
 const fromRotation=ambientWheelRotation(start,61000,previous);
 const anchored={...spin,fromRotation};assert.equal(wheelPose(anchored,spin.startedAt).rotor,fromRotation);
 const end=wheelPose(anchored,spin.resultAt).rotor;
 const pocket=WHEEL_POCKETS.indexOf(anchored.number as typeof WHEEL_POCKETS[number])*360/37;
 assert.ok(Math.abs((end+pocket)%360)<1e-8);
 assert.deepEqual(wheelPose(anchored,spin.resultAt),wheelPose(anchored,spin.nextAt-1));
});
test('all pockets preserve ambient velocity then decelerate monotonically to a fixed result',()=>{
 for(let number=0;number<=36;number++){
  const anchored={...spin,number,fromRotation:6000};
  for(const ms of [0,250,500,1000,4000])assert.ok(Math.abs((wheelPose(anchored,60000+ms+1).rotor-wheelPose(anchored,60000+ms).rotor)*1000-100)<1e-6);
  let speed=100;
  for(let ms=5000;ms<12000;ms+=100){const next=(wheelPose(anchored,60000+ms+1).rotor-wheelPose(anchored,60000+ms).rotor)*1000;assert.ok(next>=0&&next<=speed+1e-6);speed=next;}
  const end=wheelPose(anchored,72000).rotor,pocket=WHEEL_POCKETS.indexOf(number as typeof WHEEL_POCKETS[number])*360/37;
  assert.ok(Math.abs(end+pocket-Math.round((end+pocket)/360)*360)<1e-8);assert.equal(wheelPose(anchored,76999).rotor,end);
 }
});
