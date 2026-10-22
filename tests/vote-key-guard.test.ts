import {test} from "node:test";
import assert from "node:assert/strict";
import {shouldHandleVoteKey} from "../lib/vote-key-guard";
const base={metaKey:false,ctrlKey:false,altKey:false,shiftKey:false,repeat:false,defaultPrevented:false};
const el=(tagName:string,extra:Record<string,unknown>={},closest:string|null=null)=>({tagName,isContentEditable:false,closest:()=>closest?{}:null,...extra}) as unknown as EventTarget;
// Component-level unit test of the real guard used by the vote popup; not a browser run.
test("F1/F2 are ignored while typing in chat textarea, inputs, selects and contenteditable",()=>{
 for(const t of [el("TEXTAREA"),el("INPUT"),el("SELECT"),el("DIV",{isContentEditable:true})])assert.equal(shouldHandleVoteKey({...base,target:t}),false);
});
test("F1/F2 are handled after blur, on the body or a plain button",()=>{
 assert.equal(shouldHandleVoteKey({...base,target:el("BODY")}),true);
 assert.equal(shouldHandleVoteKey({...base,target:el("BUTTON")}),true);
 assert.equal(shouldHandleVoteKey({...base,target:null}),true);
});
test("modifiers, repeats, prevented events and dialog or menu contexts are ignored",()=>{
 const b=el("BODY");
 for(const k of ["metaKey","ctrlKey","altKey","shiftKey","repeat","defaultPrevented"])assert.equal(shouldHandleVoteKey({...base,[k]:true,target:b} as never),false);
 assert.equal(shouldHandleVoteKey({...base,target:el("DIV",{},"x")}),false);
});
