import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";
import {isReceiverThrow} from "../app/poker-receiver";
const seats=[{publicId:"a",name:"A"},{publicId:"b",name:"B",isYou:true},{publicId:"c",name:"C"}];
const t=(o:object)=>({id:"1",kind:"throw" as const,value:"egg",source:0,sourceId:"a",target:1,targetId:"b",...o});
test("receiver requires isYou and matching targetId",()=>{assert.equal(isReceiverThrow(t({}),seats),true);assert.equal(isReceiverThrow(t({targetId:"x"}),seats),false);assert.equal(isReceiverThrow(t({target:2,targetId:"c"}),seats),false);assert.equal(isReceiverThrow(t({sourceId:"z"}),seats),false);assert.equal(isReceiverThrow({...t({}),kind:"emote"},seats),false);});
test("overlay is body portal with reduced motion and dedupe",()=>{const s=readFileSync("app/poker-taunts.tsx","utf8"),c=readFileSync("app/poker-taunts.css","utf8");assert.match(s,/createPortal\([\s\S]*document\.body/);assert.match(s,/seen\.has/);assert.match(s,/clearTimeout/);assert.match(c,/position:fixed/);assert.match(c,/prefers-reduced-motion/);});
