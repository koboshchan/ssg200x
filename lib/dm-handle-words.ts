import {wordlist} from "@scure/bip39/wordlists/english.js";
// Pure, static, client-side word help for the four-word direct-message handle input.
// The server mints and accepts handles only from this exact list (runtime/dm-service.mjs), and there is no separate denylist.
export const HANDLE_WORD_COUNT=4;
export const MAX_SUGGESTIONS=8;
const SEP=/[\s-]/;
const WORDS=new Set<string>(wordlist);
export type HandleToken={start:number;end:number;prefix:string;index:number;count:number};
function tokens(value:string){
 const out:{start:number;end:number;text:string}[]=[],re=/[^\s-]+/g;let m:RegExpExecArray|null;
 while((m=re.exec(value))){
  const lead=m[0].startsWith("@")&&out.length===0&&m.index===0?1:0;
  if(m[0].length>lead)out.push({start:m.index+lead,end:m.index+m[0].length,text:m[0].slice(lead).toLowerCase()});
 }
 return out;
}
/** The word under the caret. A caret inside a separator run starts a fresh empty word. */
export function tokenAt(value:string,caretIn:number):HandleToken{
 const caret=Math.max(0,Math.min(Number.isFinite(caretIn)?Math.floor(caretIn):0,value.length)),ts=tokens(value);
 for(let i=0;i<ts.length;i++){
  const t=ts[i];
  if(caret>=t.start&&caret<=t.end)return {start:t.start,end:t.end,prefix:value.slice(t.start,caret).toLowerCase(),index:i,count:ts.length};
 }
 const index=ts.filter(t=>t.end<caret).length;
 return {start:caret,end:caret,prefix:"",index,count:ts.length+1};
}
/** True once the handle is four exact words, so there is nothing left to suggest. */
export function handleComplete(value:string){const ts=tokens(value);return ts.length===HANDLE_WORD_COUNT&&ts.every(t=>WORDS.has(t.text));}
/** Words starting with the typed prefix (at least one letter). Empty when the handle is complete or over four words. */
export function suggest(value:string,caret:number,limit=MAX_SUGGESTIONS):string[]{
 const t=tokenAt(value,caret);
 if(!t.prefix||!/^[a-z]+$/.test(t.prefix)||t.count>HANDLE_WORD_COUNT||t.index>=HANDLE_WORD_COUNT||handleComplete(value))return [];
 const out:string[]=[];
 for(const w of wordlist){if(w.startsWith(t.prefix)){out.push(w);if(out.length>=limit)break;}}
 return out;
}
/** Replace the word under the caret. Separators after it collapse to one space and one is added after words 1-3. Never submits. */
export function applySuggestion(value:string,caret:number,word:string):{value:string;caret:number}{
 const t=tokenAt(value,caret);
 if(!WORDS.has(word)||t.index>=HANDLE_WORD_COUNT)return {value,caret};
 const rest=value.slice(t.end),gap=rest.match(/^[\s-]+/)?.[0].length??0,tail=rest.slice(gap);
 const sep=t.index<HANDLE_WORD_COUNT-1||tail?" ":"";
 const head=value.slice(0,t.start);
 return {value:head+word+sep+tail,caret:head.length+word.length+sep.length};
}
export const isSeparator=(c:string)=>SEP.test(c);
