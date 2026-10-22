import {closeAllPerps} from "../../lib/perps-close-all";
import {financeSchema} from "../../lib/finance-input";
import {checkFinanceRequest,recordFinanceRequest} from "../../lib/finance-requests";
import {setPerpFees} from "../../lib/admin";
import {openingFeeCents,roomFeeRates} from "../../runtime/perp-fee-policy.mjs";
import {createServer} from "node:http";
import {readFileSync} from "node:fs";
import {freshRoom,register,assertRoom} from "../../lib/poker";
import {publicRoom} from "../../lib/public";
import {spot,openPosition,closePosition,requireQuote} from "../../lib/finance";
import {randomUUID} from "node:crypto";
import {resolveTriggerInput} from "../../lib/trading-settings";
import {editPositionTriggers} from "../../lib/position-triggers";
import {sellAllSpot} from "../../lib/spot-sell-all";
const who={id:"fixture",name:"Fixture",email:"fixture@example.test",admin:true};
let room=freshRoom();function reset(){room=freshRoom();register(room,who);room.quotes={BTC:{micro:82_700_000_000,at:Date.now()}};setPerpFees(room,who,0.03,1,"profit");spot(room,who,"BTC","buy",100);room.quotes!.BTC!.micro=84_500_000_000;room.quotes!.ETH={micro:3_000_000_000,at:Date.now()};openPosition(room,who,"BTC","long",10000,5,randomUUID());openPosition(room,who,"ETH","short",10000,5,randomUUID());}reset();
createServer(async(req,res)=>{res.setHeader("Cache-Control","no-store");
if(req.url==="/commit"){res.setHeader("Content-Type","text/plain");return res.end(process.env.DEMO_COMMIT||"working-tree");}
if(req.url==="/client.css"){res.setHeader("Content-Type","text/css");return res.end(readFileSync(new URL("./client.css",import.meta.url)));}
if(req.url==="/client.js"){res.setHeader("Content-Type","text/javascript");return res.end(readFileSync(new URL("./client.js",import.meta.url)));}
if(req.url==="/style.css"){res.setHeader("Content-Type","text/css");return res.end(readFileSync(new URL("../../app/globals.css",import.meta.url)));}
if(req.url==="/reset"){reset();return res.end("ok");}
if(req.url==="/demo-mark"&&req.method==="POST"){let body="";for await(const c of req){body+=c;if(body.length>128){res.statusCode=400;return res.end();}}const {micro}=JSON.parse(body);if(!Number.isSafeInteger(micro)||micro<1||micro>1e12){res.statusCode=400;return res.end();}room.quotes!.BTC={micro,at:Date.now()};res.setHeader("Content-Type","application/json");return res.end(JSON.stringify(publicRoom(room,who)));}
if(req.url==="/demo-reset"||req.url==="/demo-stale"){if(req.url==="/demo-reset")reset();else room.quotes!.ETH!.at=0;res.setHeader("Content-Type","application/json");return res.end(JSON.stringify(publicRoom(room,who)));}
if(req.url==="/room"){room.quotes!.BTC!.at=Date.now();res.setHeader("Content-Type","application/json");return res.end(JSON.stringify(publicRoom(room,who)));}
if(req.url==="/api/admin"&&req.method==="POST"){res.setHeader("Content-Type","application/json");try{let body="";for await(const c of req){body+=c;if(body.length>2048)throw Error("Too large");}const input=JSON.parse(body);if(input.type!=="perp-fees")throw Error("Unsupported");const next=structuredClone(room);setPerpFees(next,who,input.openingPercent,input.closingPercent,input.closingFeeMode);room=next;return res.end(JSON.stringify(publicRoom(room,who)));}catch(e){res.statusCode=400;return res.end(JSON.stringify({error:String(e)}));}}
if(req.url==="/api/finance"&&req.method==="POST"){let body="";for await(const c of req){body+=c;if(body.length>4096)throw Error("Too large");}res.setHeader("Content-Type","application/json");try{const input=financeSchema.parse(JSON.parse(body));if(!input.requestId||!input.requestAt)throw Error("Missing request identity");const next=structuredClone(room);next.quotes!.BTC!.at=Date.now();if(checkFinanceRequest(next,who.id,input))return res.end(JSON.stringify(publicRoom(room,who)));if(input.type==="close-all"){const result=closeAllPerps(next,who,input.positionIds,input.requestId);recordFinanceRequest(next,who.id,input,"committed");next.financeReceipts![0].closeAll=result;}
else if(input.type==="sell-all-spot")sellAllSpot(next,who,input.symbol);
else if(input.type==="spot")spot(next,who,input.symbol,input.side,input.amount);
else if(input.type==="open"){const rates=roomFeeRates(next);if(input.expectedOpeningFeePpm!==rates.openingFeePpm||input.expectedClosingFeePpm!==rates.closingFeePpm||(input.expectedClosingFeeMode??"notional")!==(next.perpClosingFeeMode??"notional"))throw Error("Trading fee changed");const patch=resolveTriggerInput(register(next,who),{entry:requireQuote(next,input.symbol),margin:input.margin-openingFeeCents(input.margin,input.leverage,rates.openingFeePpm),leverage:input.leverage,side:input.side},input);openPosition(next,who,input.symbol,input.side,input.margin,input.leverage,randomUUID(),Date.now(),{...(patch.takeProfit!=null?{takeProfit:patch.takeProfit}:{}),...(patch.stopLoss!=null?{stopLoss:patch.stopLoss}:{})});}
else if(input.type==="close")closePosition(next,who,input.positionId);
else if(input.type==="triggers"){const member=register(next,who),position=member.positions!.find(p=>p.id===input.positionId);if(!position)throw Error("Position not found");editPositionTriggers(next,who,input.positionId,resolveTriggerInput(member,position,input));}
else throw Error("Unsupported fixture action");
assertRoom(next);room=next;return res.end(JSON.stringify(publicRoom(room,who)));}catch(e){res.statusCode=400;return res.end(JSON.stringify({error:String(e)}));}}
if(req.url!=="/"){res.statusCode=404;return res.end();}
res.setHeader("Content-Type","text/html");res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/client.css"></head><body><main style="padding:24px"><div id="root"></div></main><script src="/client.js"></script></body></html>');
}).listen(Number(process.env.PORT||45827),"0.0.0.0");
