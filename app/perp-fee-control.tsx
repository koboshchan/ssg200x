"use client";
import {useState} from "react";
export default function PerpFeeControl({opening,closing,busy,post}:{opening:number;closing:number;busy:boolean;post:(path:string,body:object)=>Promise<void>}){
 const [openValue,setOpenValue]=useState(""),[closeValue,setCloseValue]=useState(""),[confirm,setConfirm]=useState(false);
 const openPercent=openValue.trim()===""?opening/10000:Number(openValue),closePercent=closeValue.trim()===""?closing/10000:Number(closeValue);
 const valid=(openValue.trim()!==""||closeValue.trim()!=="")&&[openPercent,closePercent].every(n=>Number.isFinite(n)&&n>=0&&n<=0.1&&Math.abs(n*10000-Math.round(n*10000))<1e-7);
 return <><h3>Perpetual trading fees</h3><div className="risk-row"><p>Currently {opening/10000}% opening and {closing/10000}% closing on full leveraged notional. Changes apply only to new positions; existing rates stay locked. Spot is fee-free. Range 0–0.1% each, up to four decimals.</p><div className="adjust">
 <label><span>Opening fee</span><div className="input-wrap"><input aria-label="Opening fee percent" type="number" inputMode="decimal" min="0" max="0.1" step="0.0001" placeholder={String(opening/10000)} value={openValue} onChange={e=>{setOpenValue(e.target.value);setConfirm(false);}}/><span>%</span></div></label>
 <label><span>Closing fee</span><div className="input-wrap"><input aria-label="Closing fee percent" type="number" inputMode="decimal" min="0" max="0.1" step="0.0001" placeholder={String(closing/10000)} value={closeValue} onChange={e=>{setCloseValue(e.target.value);setConfirm(false);}}/><span>%</span></div></label>
 {confirm&&valid?<><span role="status">Set {openPercent}% opening and {closePercent}% closing for new positions only?</span><button className="primary" disabled={busy} onClick={async()=>{await post("/api/admin",{type:"perp-fees",openingPercent:openPercent,closingPercent:closePercent,requestId:crypto.randomUUID(),requestAt:Date.now()});setOpenValue("");setCloseValue("");setConfirm(false);}}>Confirm fees</button><button disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button></>:<button disabled={busy||!valid} onClick={()=>setConfirm(true)}>Save fees</button>}
 </div></div></>;
}
