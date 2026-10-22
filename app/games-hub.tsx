"use client";
import Link from "next/link";
import {useFeatures} from "./use-features";
import {visibleHubGames} from "@/lib/games-hub";
import styles from "./games-hub.module.css";

function Artwork({kind}:{kind:string}){
 return <svg viewBox="0 0 240 180" fill="none" aria-hidden="true" className={styles.art}>
 {["cards","blackjack"].includes(kind)?<g transform="translate(96 27) rotate(14 55 65)">
 <rect x="-28" y="12" width="78" height="112" rx="8" fill="#253f3a" stroke="#69998b"/><path d="m-14 32 50 76m-50 0 50-76" stroke="#69998b" opacity=".5"/>
 <rect x="22" width="78" height="112" rx="8" fill="#f0eee5"/><text x="33" y="27" fill={kind==="doudizhu"?"#a64b43":"#263b35"} fontSize="22" fontFamily="Georgia">{kind==="blackjack"?"A":kind==="doudizhu"?"K":kind==="hilo"?"↑":"A"}</text><text x="60" y="78" textAnchor="middle" fill={kind==="doudizhu"?"#a64b43":"#263b35"} fontSize="42">{kind==="doudizhu"?"♦":"♠"}</text>{kind==="blackjack"?<text x="145" y="130" fill="#a4bfad" fontSize="52" fontFamily="Georgia" transform="rotate(-14)">21</text>:null}</g>:null}
 {kind==="doudizhu"?<g transform="translate(120 24)"><rect x="-22" y="17" width="56" height="98" rx="6" fill="#ac8171" transform="rotate(-19)"/><rect x="48" y="-5" width="56" height="98" rx="6" fill="#c6a08c" transform="rotate(19)"/><rect x="12" y="13" width="60" height="100" rx="6" fill="#f0e8d7"/><path d="m42 41 16 23-16 23-16-23Z" fill="#9a5545"/><path d="m24 127 5-15 13 9 13-9 5 15Z" fill="#c5a578"/></g>:null}
 {kind==="hilo"?<g transform="translate(106 30)"><rect width="65" height="105" rx="8" fill="#dce3e7" transform="rotate(-12 32 52)"/><text x="20" y="65" fill="#324550" fontFamily="Georgia" fontSize="38">7</text><rect x="60" y="23" width="65" height="105" rx="8" fill="#8494ae" transform="rotate(12 92 75)"/><path d="M92 99V53m-15 16 15-16 15 16" stroke="#e1e8ef" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/></g>:null}
 {kind==="roulette"?<g transform="translate(156 96) rotate(-18)"><circle r="76" fill="#1f3431" stroke="#bfa57a" strokeWidth="3"/>{Array.from({length:24},(_,i)=><path key={i} d="M0 -69 L0 -43" stroke={i%2?"#b87166":"#748f83"} strokeWidth="13" transform={"rotate("+i*15+")"}/>)}<circle r="38" stroke="#bfa57a"/><path d="M-28 0h56M0 -28v56" stroke="#bfa57a" strokeWidth="4"/><circle r="9" fill="#bfa57a"/><circle cx="21" cy="-55" r="5" fill="#f0eee5"/></g>:null}
 {kind==="plinko"?<g>{Array.from({length:7},(_,r)=>Array.from({length:r+2},(_,c)=><circle key={r+"-"+c} cx={151+(c-(r+1)/2)*19} cy={30+r*18} r="3" fill="#9baaa4"/>))}<circle cx="144" cy="69" r="9" fill="#d6ae70"/><path d="M91 162h120" stroke="#6a8e83" strokeWidth="12" strokeDasharray="17 4"/></g>:null}
 {kind==="mines"?<g transform="translate(99 25) rotate(12 60 65)">{Array.from({length:9},(_,i)=><rect key={i} x={i%3*40} y={Math.floor(i/3)*40} width="33" height="33" rx="6" fill="#29433c" stroke="#507466"/>)}<path d="m57 45 12 12-12 19-12-19Z" fill="#a2c7b1"/><path d="m17 5 12 12-12 19L5 17Z" fill="#a2c7b1"/></g>:null}
 {kind==="dice"?<g transform="translate(112 36) rotate(18 48 48)"><rect width="98" height="98" rx="19" fill="#dce3d8"/>{[[25,25],[73,25],[49,49],[25,73],[73,73]].map(([x,y])=><circle key={x+"-"+y} cx={x} cy={y} r="8" fill="#2d453a"/>)}</g>:null}
 {kind==="chicken"?<g><path d="M94 0v180M158 0v180M222 0v180" stroke="#45514c" strokeWidth="2" strokeDasharray="12 12"/><rect x="177" y="19" width="29" height="61" rx="10" fill="#78958d"/><ellipse cx="135" cy="118" rx="21" ry="25" fill="#e4d8b4"/><circle cx="139" cy="95" r="15" fill="#e4d8b4"/><path d="m151 94 13 6-13 5" fill="#c99d63"/><circle cx="143" cy="91" r="3" fill="#263b35"/><path d="M128 141v14m13-14v14" stroke="#c99d63" strokeWidth="4"/></g>:null}
 </svg>;
}
export default function GamesHub(){
 const {features}=useFeatures(),games=visibleHubGames(features);
 return <main className={styles.hub}><header className={styles.heading}><p>THE GAME ROOM</p><h1>Games</h1><span>Pick a table. Try your luck.</span></header>
 <div className={styles.grid}>{games.map(g=><Link key={g.key} href={g.href} className={styles.banner+" "+styles[g.art]}><Artwork kind={g.art}/><div className={styles.caption}><h2>{g.title}</h2><p>{g.detail}</p><span className={styles.play}>Play <span aria-hidden="true">↗</span></span></div></Link>)}</div>
 {!games.length?<p role="status" className={styles.empty}>The game room is taking a break. Please check back later.</p>:null}</main>;
}
