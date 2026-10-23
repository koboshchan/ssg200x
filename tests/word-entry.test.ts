import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {wordlist} from "@scure/bip39/wordlists/english.js";
import {wordSuggestions,replaceWord,wordToken,type WordHelp} from "../lib/word-entry";

const room:WordHelp={dictionary:wordlist,maxWords:3,separatorPattern:/[\s-]/};
test("room suggestions use the actual static minting dictionary, never live codes",()=>{
 const found=wordSuggestions("hel",3,room);
 assert.ok(found.includes("hello"));assert.ok(found.every(w=>wordlist.includes(w)&&w.startsWith("hel")));
 assert.deepEqual(wordSuggestions("HEL",3,room),found);
 assert.deepEqual(wordSuggestions("",0,room),[]);
 assert.deepEqual(wordSuggestions("doesnotexist",12,room),[]);
});
test("replaces only current word, keeps every completed word and separator",()=>{
 const input="  able--hel   zoo ";
 assert.deepEqual(replaceWord(input,11,"hello",room),{value:"  able--hello   zoo ",caret:16});
 assert.deepEqual(replaceWord("able-hel",8,"hello",room),{value:"able-hello ",caret:11});
 assert.deepEqual(replaceWord("able about hel",14,"hello",room),{value:"able about hello",caret:16});
 assert.deepEqual(replaceWord("helxx about zoo",3,"hello",room),{value:"hello about zoo",caret:6});
});
test("custom dictionaries and separators never bleed across contexts",()=>{
 const custom:WordHelp={dictionary:["Alpha","Alpine","Beta"],maxWords:2,separatorPattern:/[,;]/g,separator:","};
 assert.deepEqual(wordSuggestions("Al",2,custom),["Alpha","Alpine"]);
 assert.deepEqual(replaceWord("Al",2,"Alpha",custom),{value:"Alpha,",caret:6});
 assert.deepEqual(replaceWord("Beta;Alpine",7,"Alpha",custom),{value:"Beta;Alpha",caret:10});
 assert.deepEqual(wordSuggestions("hel",3,custom),[]);
 assert.equal(replaceWord("Al",2,"hello",custom).value,"Al");
});
test("word bounds are suggestion UX only, not rewriting pasted or invalid phrases",()=>{
 const over="able about zoo hel";
 assert.deepEqual(wordSuggestions(over,over.length,room),[]);
 assert.equal(replaceWord(over,over.length,"hello",room).value,over);
 assert.deepEqual(wordSuggestions("able  ",6,room),[]);
 assert.equal(wordToken("able   hel",10,room).index,1);
 assert.equal(wordToken("hel",Infinity,room).prefix,"");
 assert.deepEqual(wordSuggestions("hel",3,{...room,limit:0}),[]);
 assert.equal(replaceWord("  HEL\\tzz  ",5,"not-in-dictionary",room).value,"  HEL\\tzz  ");
});
test("recovery whitespace is not room hyphen normalization; legacy payment counts still work",()=>{
 const recovery:WordHelp={dictionary:wordlist,maxWords:6};
 const payment:WordHelp={dictionary:wordlist,maxWords:4};
 assert.deepEqual(wordSuggestions("able-hel",8,recovery),[]);
 assert.ok(wordSuggestions("able about zoo hel",18,payment).includes("hello"));
 assert.deepEqual(replaceWord("able about zoo hel",18,"hello",payment),{value:"able about zoo hello",caret:20});
 assert.ok(wordSuggestions("able about zoo wish able hel",27,recovery).includes("hello"));
});
test("selection within a word is supported; cross-word selection never deletes another word",()=>{
 assert.ok(wordSuggestions("able hello zoo",8,room,6).includes("hello"));
 assert.deepEqual(wordSuggestions("able hello zoo",8,room,2),[]);
 assert.equal(replaceWord("able hello zoo",8,"hello",room,2).value,"able hello zoo");
});
test("component has no lookup, logging, persistence, analytics, or browser autocomplete",()=>{
 const source=readFileSync(new URL("../app/word-entry.tsx",import.meta.url),"utf8");
 const helper=readFileSync(new URL("../lib/word-entry.ts",import.meta.url),"utf8");
 assert.doesNotMatch(source+helper,/\b(fetch|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon)\b|console\./);
 assert.match(source,/autoComplete="off"/);assert.match(source,/spellCheck=\{false\}/);
 assert.match(source,/data-1p-ignore/);assert.match(source,/data-lpignore="true"/);
 assert.match(source,/readOnly=\{readOnly\}/);
});
