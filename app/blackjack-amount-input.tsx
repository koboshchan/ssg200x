"use client";
import type {InputHTMLAttributes} from "react";
import {isBlackjackInputText} from "@/lib/blackjack-amount";
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type" | "step" | "inputMode" | "min" | "max"> & {value: string; onChange: (value: string) => void};
/** Text field with decimal keypad; rejects whole invalid edits (typed, pasted, or changed). */
export default function BlackjackAmountInput({value,onChange,...props}: Props) {
 const next=(el:HTMLInputElement,ins:string)=>el.value.slice(0,el.selectionStart??el.value.length)+ins+el.value.slice(el.selectionEnd??el.value.length);
 return <input {...props} type="text" inputMode="decimal" autoComplete="off" value={value}
  onPaste={e=>{if(!isBlackjackInputText(next(e.currentTarget,e.clipboardData.getData("text"))))e.preventDefault();}}
  onBeforeInput={e=>{const d=(e.nativeEvent as InputEvent).data;if(d&&!isBlackjackInputText(next(e.currentTarget,d)))e.preventDefault();}}
  onChange={e=>{if(isBlackjackInputText(e.target.value))onChange(e.target.value);}}/>;
}
