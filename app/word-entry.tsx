"use client";
import {useEffect,useId,useLayoutEffect,useRef,useState} from "react";
import {wordlist} from "@scure/bip39/wordlists/english.js";
import {replaceWord,wordSuggestions} from "@/lib/word-entry";
import "./word-entry.css";

export type WordEntryProps={
 value:string; onChange:(value:string)=>void; count:number;
 dictionary?:readonly string[]; separatorPattern?:RegExp; separator?:string;
 // A suggestion limit only, never a typing, paste, or submission validator.
 maxWords?:number; disabled?:boolean; readOnly?:boolean; label?:string;
 placeholder?:string; inputClassName?:string;
};

export default function WordEntry({value,onChange,count,dictionary=wordlist,
 separatorPattern,separator=" ",maxWords=count,disabled=false,readOnly=false,
 label="Recovery words",placeholder,inputClassName}:WordEntryProps){
 const id=useId(),input=useRef<HTMLInputElement>(null),pendingCaret=useRef<number|null>(null);
 const [selection,setSelection]=useState({start:0,end:0});
 const [focused,setFocused]=useState(false),[active,setActive]=useState(-1);
 const [dismissed,setDismissed]=useState(false),[composing,setComposing]=useState(false);
 const options={dictionary,maxWords,separatorPattern,separator};
 const matches=wordSuggestions(value,selection.end,options,selection.start);
 const expanded=focused&&!disabled&&!readOnly&&!composing&&!dismissed&&matches.length>0;
 const selected=active>=0?Math.min(active,matches.length-1):-1;
 useLayoutEffect(()=>{
  if(pendingCaret.current!==null&&input.current){
   input.current.setSelectionRange(pendingCaret.current,pendingCaret.current);
   pendingCaret.current=null;
  }
 },[value,selection.start,selection.end]);
 useEffect(()=>{
  if(expanded&&selected>=0)document.getElementById(id+"-option-"+selected)?.scrollIntoView({block:"nearest"});
 },[expanded,id,selected]);
 function syncSelection(){
  const element=input.current;if(!element)return;
  const next={start:element.selectionStart??0,end:element.selectionEnd??0};
  if(next.start!==selection.start||next.end!==selection.end){setActive(-1);setDismissed(false);}
  setSelection(next);
 }
 function pick(word:string){
  if(disabled||readOnly||composing)return;
  const next=replaceWord(value,selection.end,word,options,selection.start);
  pendingCaret.current=next.caret;
  setSelection({start:next.caret,end:next.caret});setActive(-1);setDismissed(true);
  onChange(next.value);
  // Pointer-down keeps focus on the input. Never steal focus back from elsewhere.
 }
 return <div className="word-entry">
  <label className="word-entry-label" htmlFor={id}>{label}</label>
  <div className="word-entry-textbox">
   <input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-haspopup="listbox"
    aria-expanded={expanded} aria-controls={expanded?id+"-suggestions":undefined}
    aria-activedescendant={expanded&&selected>=0?id+"-option-"+selected:undefined}
    autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
    data-1p-ignore data-lpignore="true" data-form-type="other"
    className={inputClassName} placeholder={placeholder??Array.from({length:count},()=>"word").join(separator)}
    value={value} disabled={disabled} readOnly={readOnly}
    onFocus={()=>{setFocused(true);setActive(-1);setDismissed(false);syncSelection();}}
    onBlur={()=>{setFocused(false);setDismissed(true);}}
    onSelect={syncSelection}
    onCompositionStart={()=>{setComposing(true);setActive(-1);}}
    onCompositionEnd={()=>{setComposing(false);syncSelection();setDismissed(false);}}
    onChange={event=>{
     setSelection({start:event.target.selectionStart??event.target.value.length,end:event.target.selectionEnd??event.target.value.length});
     setActive(-1);setDismissed(false);onChange(event.target.value);
    }}
    onKeyDown={event=>{
     if(disabled||readOnly||composing||event.nativeEvent.isComposing||event.nativeEvent.keyCode===229)return;
     if(event.key==="Escape"){
      if(expanded){event.preventDefault();event.stopPropagation();}
      setDismissed(true);setActive(-1);return;
     }
     if(event.key==="Tab"){setDismissed(true);setActive(-1);return;}
     if((event.key==="ArrowDown"||event.key==="ArrowUp")&&matches.length){
      event.preventDefault();setDismissed(false);
      setActive(!expanded||selected<0?(event.key==="ArrowDown"?0:matches.length-1):
       (selected+(event.key==="ArrowDown"?1:-1)+matches.length)%matches.length);
     }
     if(event.key==="Enter"&&expanded&&selected>=0){event.preventDefault();pick(matches[selected]);}
    }}/>
   {expanded?<div className="word-entry-suggestions" role="listbox" aria-label="Word suggestions" id={id+"-suggestions"}>
    {matches.map((word,index)=><button type="button" role="option" tabIndex={-1} key={word}
     id={id+"-option-"+index} aria-selected={index===selected}
     onPointerDown={event=>event.preventDefault()} onClick={()=>pick(word)}>{word}</button>)}
   </div>:null}
  </div>
 </div>;
}
