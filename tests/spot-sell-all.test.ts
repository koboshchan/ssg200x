import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register,assertRoom} from "./helpers/crypto-room";
import {spot,value} from "../lib/finance";
import {sellAllSpot} from "../lib/spot-sell-all";
const who={id:"spot-owner",name:"Spot Owner",email:"spot@example.test",admin:false};
function setup(){const r=freshRoom();register(r,who);r.quotes={BTC:{cryptoGeneration:"fixture",micro:82_700_000_000,at:1000}};spot(r,who,"BTC","buy",100,1000);return r;}
test("exact screenshot-sized BTC holding sells without rounded-dollar dust",()=>{
 const r=setup(),m=r.members[0];assert.equal(m.holdings![0].units,1209);
 r.quotes!.BTC!.micro=84_500_000_000;const expected=value(m.holdings![0].units,r.quotes!.BTC!.micro),cash=m.wallet;
 sellAllSpot(r,who,"BTC",1000);
 assert.equal(m.wallet,cash+expected);assert.equal(expected,102);assert.equal(m.holdings!.length,0);assertRoom(r);
 const before=structuredClone(r);assert.throws(()=>sellAllSpot(r,who,"BTC",1000));assert.deepEqual(r,before);
});
test("below-dollar holding settles exact units and floors proceeds, never rounds up",()=>{
 const r=setup(),m=r.members[0];r.quotes!.BTC!.micro=41_350_000_000;const cash=m.wallet;
 sellAllSpot(r,who,"BTC",1000);assert.equal(m.wallet,cash+49);assert.equal(m.holdings!.length,0);assertRoom(r);
});
test("subcent holding is retained unchanged instead of destroyed or paid a free cent",()=>{
 const r=setup();r.quotes!.BTC!.micro=1;const before=structuredClone(r);
 assert.throws(()=>sellAllSpot(r,who,"BTC",1000),/less than/);assert.deepEqual(r,before);
});
test("stale/future quote, closed stock, non-owner and host limit fail without mutations",()=>{
 for(const kind of ["stale","future","stock","owner","limit"]){
  const r=setup();let actor=who,symbol="BTC",now=1000;
  if(kind==="stale")now=16001;
  if(kind==="future")r.quotes!.BTC!.at=1001;
  if(kind==="stock"){r.members[0].holdings![0].symbol="AAPL";r.quotes!.AAPL={cryptoGeneration:"fixture",micro:200_000_000,at:1000};symbol="AAPL";}
  if(kind==="owner")actor={...who,id:"other"};
  if(kind==="limit"){r.quotes!.BTC!.micro*=2;r.limits={maxTrade:1,maxLeverage:200};}
  const before=structuredClone(r);assert.throws(()=>sellAllSpot(r,actor,symbol,now));assert.deepEqual(r,before);
 }
});
test("repeated buy/sell cannot create funds through unit or cent rounding",()=>{
 const r=setup(),initial=r.members[0].wallet+100;sellAllSpot(r,who,"BTC",1000);
 for(let i=0;i<100;i++){spot(r,who,"BTC","buy",100,1000);sellAllSpot(r,who,"BTC",1000);assertRoom(r);}
 assert.ok(r.members[0].wallet<=initial);assert.equal(r.members[0].holdings!.length,0);
});
