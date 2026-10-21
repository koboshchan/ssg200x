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
 const color=first.color||roulettePlayerColor(first.publicId);
 const chips=group.map(w=>({amount:w.bet.amount,color:first.isYou?(ROULETTE_CHIPS.find(d=>d.value*100===w.bet.amount)?.color||"#5f9cbb"):color}));
 const piles=[{amount:first.isYou?chips[chips.length-1].amount:total,count:chips.length,color,chips}];
 return {...first,total,piles};
 });
}
// Stable assignment by public identity, never by changing table order.
export function roulettePlayerColor(publicId:string){
 const palette=["#4284ad","#b7474b","#45956c","#a56ab8","#dd8550","#c59b48"];
 let hash=0;for(const char of publicId)hash=(Math.imul(hash,31)+char.charCodeAt(0))>>>0;
 return palette[hash%palette.length];
}
const dollars=(n:number)=>"$"+(n/100).toLocaleString("en-US");
export function RouletteBetChips({bets}:{bets:TableChipBet[]}){
 return <span className={styles.groups}>{rouletteStacks(bets).map(player=><span key={player.publicId} className={styles.player} title={player.name+" "+dollars(player.total)} aria-label={player.name+" "+dollars(player.total)+", "+bets.filter(w=>w.publicId===player.publicId).length+" chips"}>
 <span className={styles.piles}>{player.piles.map(pile=><span key={pile.amount} className={clay.pile+" "+styles.pile} style={{"--chip-color":pile.color,"--count":pile.count} as CSSProperties} data-owner={player.publicId} data-denomination={player.isYou?pile.amount/100:undefined} data-count={pile.count}>
 {pile.chips.map((chip,i)=><span key={i} className={clay.chip} data-chip-denomination={player.isYou?chip.amount/100:undefined} style={{bottom:i*5,"--chip-color":chip.color} as CSSProperties}>{i===pile.count-1?<b className={clay.face}>{dollars(pile.amount)}</b>:null}</span>)}
 </span>)}</span><span className={styles.name}>{player.name}{player.isYou?" (you)":""}</span>
 </span>)}</span>;
}
