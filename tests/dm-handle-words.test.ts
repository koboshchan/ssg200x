import test from "node:test";import assert from "node:assert/strict";
import {suggest,applySuggestion,tokenAt,handleComplete,MAX_SUGGESTIONS} from "../lib/dm-handle-words";
import {wordlist} from "@scure/bip39/wordlists/english.js";
test("suggests by prefix from the supported list only",()=>{
 const r=suggest("ab",2);assert.ok(r.length>0&&r.length<=MAX_SUGGESTIONS);assert.ok(r.every(w=>w.startsWith("ab")&&wordlist.includes(w)));
 assert.deepEqual(suggest("AB",2),r);assert.deepEqual(suggest("",0),[]);assert.deepEqual(suggest("zzzq",4),[]);assert.deepEqual(suggest("1a",2),[]);
});
test("separators start a fresh word",()=>{
 assert.equal(tokenAt("able ",5).index,1);assert.equal(tokenAt("able-",5).prefix,"");assert.deepEqual(suggest("able ",5),[]);
 assert.ok(suggest("able-ab",7).every(w=>w.startsWith("ab")));assert.ok(suggest("able   ab",9).length>0);assert.ok(suggest("@ab",3).length>0);
});
test("caret edits target the word under the caret",()=>{
 const v="able abou zoo wish";
 assert.equal(tokenAt(v,7).prefix,"ab");assert.equal(tokenAt(v,7).index,1);assert.ok(suggest(v,7).every(w=>w.startsWith("ab")));
 const r=applySuggestion(v,7,"about");assert.equal(r.value,"able about zoo wish");assert.equal(r.caret,"able about ".length);
 const h=applySuggestion("able-abou-zoo-wish",9,"about");assert.equal(h.value,"able-about zoo-wish");
 assert.equal(applySuggestion("ab",2,"able").value,"able ");
});
test("pasted full handles are preserved and hide suggestions",()=>{
 assert.equal(handleComplete("able about zoo wish"),true);assert.equal(handleComplete("able-about-zoo-wish"),true);
 assert.deepEqual(suggest("able about zoo wish",19),[]);assert.deepEqual(suggest("able about zoo wi",17),suggest("able about zoo wi",17));
 assert.equal(applySuggestion("able about zoo wi",17,"wild").value,"able about zoo wild");
});
test("bounds: max four words, bad caret, unknown words",()=>{
 assert.deepEqual(suggest("able about zoo wish ab",22),[]);assert.deepEqual(suggest("a b c d ab",10),[]);
 assert.equal(tokenAt("ab",-5).start,0);assert.equal(tokenAt("ab",99).end,2);assert.equal(tokenAt("ab",NaN).prefix,"");
 assert.equal(applySuggestion("ab",2,"notaword").value,"ab");assert.equal(applySuggestion("a b c d ab",10,"able").value,"a b c d ab");
 assert.equal(applySuggestion("able about zoo wi",17,"wild").value.split(" ").length,4);
});
