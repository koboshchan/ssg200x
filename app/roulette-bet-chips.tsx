import type {CSSProperties} from "react";
import {ROULETTE_CHIPS} from "@/lib/roulette-chips";
import clay from "./blackjack-bet-chips.module.css";
import styles from "./roulette-bet-chips.module.css";
export type TableChipBet={id:string;publicId:string;name:string;isYou:boolean;bet:{amount:number};color?:string};
export function rouletteStacks(bets:TableChipBet[]){
 const players=new Map<string,TableChipBet[]>();
 for(const bet of bets){const group=players.get(bet.publicId)||[];group.push(bet);players.set(bet.publicId,group);}
 return [...players.values()].map(group=>{
 const first=group[0],total=group.reduce((sum,w)=>sum+w.bet.amount,0);
 const piles=first.isYou?[...new Set(group.map(w=>w.bet.amount))].map(amount=>({amount,count:group.filter(w=>w.bet.amount===amount).length,color:ROULETTE_CHIPS.find(d=>d.value*100===amount)?.color||"#5f9cbb"})):[{amount:total,count:group.length,color:first.color||"#b59150"}];
 return {...first,total,piles};
 });
}
const dollars=(n:number)=>"$"+(n/100).toLocaleString("en-US");
export function RouletteBetChips({bets}:{bets:TableChipBet[]}){
 return <span className={styles.groups}>{rouletteStacks(bets).map(player=><span key={player.publicId} className={styles.player} title={player.name+" "+dollars(player.total)} aria-label={player.name+" "+dollars(player.total)+", "+bets.filter(w=>w.publicId===player.publicId).length+" chips"}>
 <span className={styles.piles}>{player.piles.map(pile=><span key={pile.amount} className={clay.pile+" "+styles.pile} style={{"--chip-color":pile.color,"--count":pile.count} as CSSProperties} data-owner={player.publicId} data-denomination={player.isYou?pile.amount/100:undefined} data-count={pile.count}>
 {Array.from({length:pile.count},(_,i)=><span key={i} className={clay.chip} style={{bottom:i*5}}>{i===pile.count-1?<b className={clay.face}>{dollars(pile.amount)}</b>:null}</span>)}
 </span>)}</span><span className={styles.name}>{player.name}{player.isYou?" (you)":""}</span>
 </span>)}</span>;
}
