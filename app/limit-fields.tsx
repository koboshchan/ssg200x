"use client";
import {useId} from "react";
import {LIMIT_FIELDS,toCents,toDollars,type Limits} from "./app-api-client";
/** Editable dollar limits. Values are text so partial typing works; parse with parseLimits. */
export type LimitText=Record<keyof Limits,string>;
export const limitText=(l:Limits):LimitText=>({per_operation_cents:toDollars(l.per_operation_cents),daily_cents:toDollars(l.daily_cents),lifetime_cents:toDollars(l.lifetime_cents)});
export function parseLimits(t:LimitText,max:Limits):{limits?:Limits;error?:string}{
 const out={} as Limits;
 for(const f of LIMIT_FIELDS){const c=toCents(t[f.key]);if(c===null)return {error:f.label+" must be dollars, like 25 or 25.50."};if(c>max[f.key])return {error:f.label+" can be at most "+toDollars(max[f.key])+" dollars."};out[f.key]=c;}
 if(out.per_operation_cents>out.daily_cents||out.daily_cents>out.lifetime_cents)return {error:"Keep per operation at or below per day, and per day at or below total."};
 return {limits:out};
}
export default function LimitFields({value,max,onChange,disabled,legend="Spending limits"}:{value:LimitText;max:Limits;onChange:(v:LimitText)=>void;disabled?:boolean;legend?:string}){
 const id=useId();
 return <fieldset className="app-limits" disabled={disabled}><legend>{legend}</legend>
  {LIMIT_FIELDS.map(f=><label key={f.key} htmlFor={id+f.key}><span>{f.label}</span><span className="input-wrap"><span aria-hidden="true">$</span><input id={id+f.key} type="text" inputMode="decimal" autoComplete="off" value={value[f.key]} onChange={e=>onChange({...value,[f.key]:e.target.value})} aria-describedby={id+"max"}/></span></label>)}
  <small id={id+"max"}>Most allowed: {LIMIT_FIELDS.map(f=>toDollars(max[f.key])).map((v,i)=>["per operation","per day","total"][i]+" $"+v).join(", ")}.</small>
 </fieldset>;
}
