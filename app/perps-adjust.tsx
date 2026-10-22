"use client";
import {useId,useRef,useState} from "react";
import type {PublicRoom} from "@/lib/public";
import {openingFeeCents,closingFeeCents} from "../runtime/perp-fee-policy.mjs";
import {positionSlice,increasedEntry} from "../runtime/perp-adjustments.mjs";
import styles from "./in-play-navigation.module.css";
type Position=PublicRoom["positions"][number];
type Props={position:Position;room:PublicRoom;busy:boolean;disabled:boolean;post:(path:string,body:object)=>Promise<void>};
const money=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n/100);
export default function PerpsAdjust({position,room,busy,disabled,post}:Props){
 const dialog=useRef<HTMLDialogElement>(null),cancel=useRef<HTMLButtonElement>(null),lock=useRef(false),title=useId(),description=useId();
 const [selected,setSelected]=useState(position);
 const [kind,setKind]=useState<"increase"|"partial-close">("increase"),[amount,setAmount]=useState("100"),[bps,setBps]=useState(5000),[working,setWorking]=useState(false),[error,setError]=useState("");
 const p=selected,mark=room.quotes[p.symbol]?.micro;
 const cents=Math.round(Number(amount)*100),fee=Number.isSafeInteger(cents)&&cents>=100&&cents<=100_000_000?openingFeeCents(cents,p.leverage,p.openingFeePpm??p.feePpm??0):0;
 let preview:string|null=null,valid=false;
 if(kind==="increase"){
  valid=Number.isSafeInteger(cents)&&cents>=100&&cents<=100_000_000&&cents<=room.me.wallet;
  if(valid&&mark)preview=`Wallet debit ${money(cents)}. Opening fee ${money(fee)}. Added notional ${money((cents-fee)*p.leverage)} at ${p.leverage}x. Estimated new average entry $${(increasedEntry(p,cents-fee,mark)/1e6).toFixed(6)}.`;
 }else if(bps>0){
  try{const {slice,remainder}=positionSlice(p,bps);valid=true;
   if(mark){const pnl=Math.floor(slice.margin*slice.leverage*(mark-slice.entry)/slice.entry*(slice.side==="long"?1:-1)),closing=closingFeeCents(slice,mark,pnl),returned=Math.max(0,(slice.collateral??slice.margin)+pnl-closing);
    preview=`Closes ${money(slice.margin)} of margin. Estimated return ${money(returned)}, closing fee ${money(Math.min(closing,Math.max(0,(slice.collateral??slice.margin)+pnl)))}. Net realized P/L ${money(returned-(slice.postedMargin??slice.margin)-(slice.collateral===undefined?(slice.openingFee??0):0))}. Remaining margin ${money(remainder.margin)}.`;}
  }catch{preview="Selected portion is below one cent of margin. Increase the percentage.";}
 }
 function open(kind:"increase"|"partial-close"){
  if(busy||lock.current||disabled)return;setSelected({...position});setKind(kind);setAmount("100");setBps(5000);setError("");dialog.current?.showModal();cancel.current?.focus();
 }
 async function execute(){
  if(busy||lock.current||!valid)return;lock.current=true;setWorking(true);setError("");
  try{await post("/api/finance",{type:kind,positionId:p.id,expectedRevision:p.revision??0,...(kind==="increase"?{margin:cents}:{percentBps:bps})});dialog.current?.close();}
  catch(e){setError(e instanceof Error?e.message:"Could not confirm the outcome. Refresh before trying again.");}
  finally{lock.current=false;setWorking(false);}
 }
 return <div className="perps-adjust"><button type="button" disabled={busy||working||disabled} onClick={()=>open("increase")}>Add margin</button><button type="button" disabled={busy||working||disabled} onClick={()=>open("partial-close")}>Partial close</button>
 <dialog ref={dialog} className={styles.dialog} aria-labelledby={title} aria-describedby={description} onCancel={e=>{if(working)e.preventDefault();}}>
 <h2 id={title}>{kind==="increase"?"Increase":"Partially close"} {p.symbol} {p.side}?</h2>
 <p id={description}>{kind==="increase"?"Add margin increases your position, not just its collateral. It buys more exposure at the fresh server price with the same leverage and locked fees. Average entry and liquidation are recalculated. Entry rounds by less than $0.000001 against your side, never in your favor. TP/SL prices stay unchanged.":"Closes the selected fraction at the fresh server price. Profit or loss and fees are realized proportionally. The remainder keeps its entry, leverage and TP/SL. 100% closes the full position."}</p>
 {kind==="increase"?<label>Additional margin ($)<input aria-label={"Additional margin for "+p.symbol} type="number" min="1" max={Math.min(1000000,room.me.wallet/100)} step="0.01" value={amount} disabled={working} onChange={e=>setAmount(e.target.value)}/></label>:<label>Portion to close · {bps/100}%<input aria-label={"Close percentage of "+p.symbol} aria-valuetext={bps/100+"%"} type="range" min="0" max="10000" step="1" value={bps} disabled={working} onChange={e=>setBps(Number(e.target.value))}/></label>}
 <p role="status">{preview??"Enter a valid amount. No order has been placed."}</p><small>Estimates only. The server rechecks the quote, wallet and position when you confirm. Cent dust stays in the remainder; partial closing fees round up to the next cent to prevent splitting away fees.</small>
 {error?<p role="alert">{error}</p>:null}<div className={styles.actions}><button type="button" disabled={busy||working||!valid||!mark} onClick={()=>void execute()}>{working?"Working…":"Confirm"}</button><button type="button" ref={cancel} className="primary" disabled={working} onClick={()=>dialog.current?.close()}>Cancel</button></div>
 </dialog></div>;
}
