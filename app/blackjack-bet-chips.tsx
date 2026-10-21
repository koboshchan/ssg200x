import type {CSSProperties} from "react";
import {blackjackChips,blackjackChipStacks} from "@/lib/blackjack-chips";
import styles from "./blackjack-bet-chips.module.css";
export function BlackjackBetChips({amount,chips}:{amount:number;chips?:number[]}){
 const stacks=blackjackChipStacks(blackjackChips(amount,chips));
 if(!stacks.length)return <small>Bet ${(amount/100).toLocaleString("en-US")}</small>;
 const label=stacks.map(s=>s.count+" × $"+s.value).join(" + ");
 return <div className={styles.bet} role="group" aria-label={"Bet chips: "+label}>
  <div className={styles.stacks}>{stacks.map((s,i)=><div key={s.value+"-"+i} className={styles.stack} style={{"--chip-color":s.color,"--count":s.count} as CSSProperties} data-denomination={s.value} data-count={s.count}>
   <div className={styles.pile} aria-hidden="true">{Array.from({length:s.count},(_,j)=><span key={j} className={styles.chip} style={{bottom:j*3}}>{j===s.count-1?"$"+s.value:null}</span>)}</div>
   <span className={styles.count}>{s.count} × ${s.value}</span>
  </div>)}</div>
 </div>;
}
