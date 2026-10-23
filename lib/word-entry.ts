// Local word help only. No I/O, logging, storage, or validation of submitted phrases.
export type WordHelp = {
 dictionary: readonly string[];
 maxWords: number;
 separatorPattern?: RegExp;
 separator?: string;
 limit?: number;
};
type Token = {start:number;end:number;index:number;count:number;prefix:string};
const clamp=(n:number,size:number)=>Math.max(0,Math.min(Number.isFinite(n)?Math.floor(n):0,size));
function separatorTest(options:WordHelp){
 const pattern=options.separatorPattern??/\s/;
 const safe=new RegExp(pattern.source,pattern.flags.replace(/[gy]/g,""));
 return (char:string)=>safe.test(char);
}
export function wordToken(value:string,caretIn:number,options:WordHelp):Token{
 const caret=clamp(caretIn,value.length),isSeparator=separatorTest(options);
 const tokens:{start:number;end:number}[]=[];
 for(let i=0;i<value.length;){
  if(isSeparator(value[i])){i++;continue;}
  const start=i;while(i<value.length&&!isSeparator(value[i]))i++;
  tokens.push({start,end:i});
 }
 const index=tokens.findIndex(t=>caret>=t.start&&caret<=t.end);
 if(index>=0){const token=tokens[index];return {...token,index,count:tokens.length,prefix:value.slice(token.start,caret).toLowerCase()};}
 return {start:caret,end:caret,index:tokens.filter(t=>t.end<caret).length,count:tokens.length+1,prefix:""};
}
export function wordSuggestions(value:string,caret:number,options:WordHelp,selectionStart=caret):string[]{
 const token=wordToken(value,caret,options),limit=options.limit??8,isSeparator=separatorTest(options);
 if(!token.prefix||token.index>=options.maxWords||token.count>options.maxWords||limit<=0||
    selectionStart<token.start||selectionStart>token.end)return [];
 const result:string[]=[],seen=new Set<string>();
 for(const word of options.dictionary){
  if(word.toLowerCase().startsWith(token.prefix)&&!seen.has(word)&&word.length>0&&
    !Array.from(word).some(isSeparator)){
   seen.add(word);result.push(word);if(result.length>=limit)break;
  }
 }
 return result;
}
export function replaceWord(value:string,caret:number,word:string,options:WordHelp,selectionStart=caret){
 if(!wordSuggestions(value,caret,{...options,limit:Infinity},selectionStart).includes(word))return {value,caret};
 const token=wordToken(value,caret,options),suffix=value.slice(token.end),separator=options.separator??" ";
 // Never rewrite existing whitespace, other words, or pasted phrases.
 const append=!suffix&&token.index<options.maxWords-1?separator:"";
 const next=value.slice(0,token.start)+word+append+suffix;
 let nextCaret=token.start+word.length+append.length;
 const isSeparator=separatorTest(options);
 for(let i=0;i<suffix.length&&isSeparator(suffix[i]);i++)nextCaret++;
 return {value:next,caret:nextCaret};
}
