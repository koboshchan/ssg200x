"use client";
import type {InputHTMLAttributes} from "react";
import {isCasinoInputText} from "@/lib/casino-amount";
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type" | "step" | "inputMode"> & {value: string; onChange: (value: string) => void};
/** Keep native numeric semantics and reject entire invalid edits, including pasted text. */
export default function CasinoAmountInput({value,onChange,...props}: Props) {
 return <input {...props} type="number" inputMode="numeric" step="1" value={value}
  onKeyDown={e=>{if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.key.length===1&&!isCasinoInputText(e.key))e.preventDefault();}}
  onPaste={e=>{if(!isCasinoInputText(e.clipboardData.getData("text")))e.preventDefault();}}
  onBeforeInput={e=>{const data=(e.nativeEvent as InputEvent).data;if(data&&!isCasinoInputText(data))e.preventDefault();}}
  onChange={e=>{if(isCasinoInputText(e.target.value))onChange(e.target.value);}}/>;
}
