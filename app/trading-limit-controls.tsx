"use client";
import {useState} from "react";
import {validTradeLimit} from "@/lib/trade-limit";
import type {PublicRoom} from "@/lib/public";
const money=(c:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(c/100);
export default function LimitsControls({room,busy,post}:{room:PublicRoom;busy:boolean;post:(path:string,body:object)=>Promise<void>}){
 const [trade,setTrade]=useState(""),[lev,setLev]=useState(""),[ask,setAsk]=useState(false);
 const t=trade.trim()===""?room.limits.maxTrade:Number(trade),l=lev.trim()===""?room.limits.maxLeverage:Number(lev);
 const valid=(trade.trim()!==""||lev.trim()!=="")&&validTradeLimit(t)&&Number.isInteger(l)&&l>=1&&l<=200;
 return <><h3>Trading limits</h3><div className="risk-row"><p>Max per trade {money(room.limits.maxTrade*100)}. Max leverage {room.limits.maxLeverage}x. The trade cap applies to spot orders, perp margin and perp notional.</p>
  <div className="adjust"><label><span className="sr-only">Max trade in dollars</span><div className="input-wrap"><span>$</span><input type="number" min="0.01" step="0.01" placeholder={String(room.limits.maxTrade)} value={trade} onChange={e=>{setTrade(e.target.value);setAsk(false);}}/></div></label><label><span className="sr-only">Max leverage</span><div className="input-wrap"><input type="number" min="1" max="200" step="1" placeholder={String(room.limits.maxLeverage)} value={lev} onChange={e=>{setLev(e.target.value);setAsk(false);}}/><span>x</span></div></label>
  {ask&&valid?<><span className="adjust-note" role="status">Set max trade {money(t*100)} and max leverage {l}x? Existing positions are not closed.</span><button className="primary" disabled={busy} onClick={async()=>{await post("/api/admin",{type:"limits",maxTrade:t,maxLeverage:l,requestId:crypto.randomUUID(),requestAt:Date.now()});setTrade("");setLev("");setAsk(false);}}>Confirm</button><button disabled={busy} onClick={()=>setAsk(false)}>Cancel</button></>:<button disabled={busy||!valid} onClick={()=>setAsk(true)}>Save limits</button>}</div></div></>;
}
