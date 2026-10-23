"use client";
import Link from "next/link";
import {useFeatures} from "./use-features";
import {visibleHubGames} from "@/lib/games-hub";
import styles from "./games-hub.module.css";

function Artwork({kind}:{kind:string}){
 return <svg viewBox="0 0 240 180" fill="none" aria-hidden="true" className={styles.art}>
 {kind==="cards"?<g>
 <ellipse cx="166" cy="145" rx="65" ry="15" fill="#0c201b" opacity=".5"/>
 <g transform="translate(93 39) rotate(-8 64 36)">{[0,1,2,3,4].map((i)=><g key={i} transform={"translate("+i*23+" 0)"}><rect width="31" height="55" rx="4" fill={i<3?"#e7e4d8":"#bdcdbf"} stroke="#415d50"/><text x="5" y="17" fontSize="13" fontFamily="Georgia" fill={i===1||i===3?"#a75850":"#293f34"}>{["A","K","Q","J","10"][i]}</text><text x="15" y="39" textAnchor="middle" fontSize="19" fill={i===1||i===3?"#a75850":"#293f34"}>{["♠","♥","♣","♦","♠"][i]}</text></g>)}</g>
 {[{x:142,y:123,c:"#567c6b",n:3},{x:184,y:139,c:"#b99764",n:5},{x:211,y:113,c:"#946659",n:2}].map(({x,y,c,n})=><g key={x}>{Array.from({length:n},(_,i)=><g key={i}><ellipse cx={x} cy={y-i*6} rx="23" ry="10" fill={c} stroke="#192f27" strokeWidth="2"/><ellipse cx={x} cy={y-i*6-2} rx="16" ry="6" stroke="#e8e3ce" strokeDasharray="5 5" opacity=".7"/></g>)}</g>)}
 </g>:null}
 {kind==="blackjack"?<g>
 <text x="172" y="75" textAnchor="middle" fill="#9fb786" opacity=".25" fontSize="83" fontWeight="700" fontFamily="Georgia">21</text>
 <g transform="translate(112 50) rotate(-17 30 49)"><rect width="59" height="94" rx="7" fill="#d3dac8" stroke="#71917b"/><text x="8" y="24" fill="#914e43" fontSize="19" fontFamily="Georgia">K</text><path d="m30 33 13 18-13 18-13-18Z" fill="#aa6254"/><text x="43" y="83" fill="#914e43" fontSize="17" fontFamily="Georgia">K</text></g>
 <g transform="translate(167 56) rotate(12 29 47)"><rect width="59" height="94" rx="7" fill="#f1ebd9" stroke="#b4b995"/><text x="8" y="24" fill="#263c30" fontSize="19" fontFamily="Georgia">A</text><text x="29" y="66" textAnchor="middle" fill="#263c30" fontSize="39">♠</text></g>
 <rect x="128" y="136" width="71" height="29" rx="14" fill="#b8c998" stroke="#314b35" strokeWidth="2"/><text x="163" y="157" textAnchor="middle" fill="#253b2c" fontSize="23" fontFamily="Georgia" fontWeight="700">21</text>
 </g>:null}
 {kind==="doudizhu"?<g transform="translate(120 24)"><rect x="-22" y="17" width="56" height="98" rx="6" fill="#ac8171" transform="rotate(-19)"/><rect x="48" y="-5" width="56" height="98" rx="6" fill="#c6a08c" transform="rotate(19)"/><rect x="12" y="13" width="60" height="100" rx="6" fill="#f0e8d7"/><path d="m42 41 16 23-16 23-16-23Z" fill="#9a5545"/><path d="m24 127 5-15 13 9 13-9 5 15Z" fill="#c5a578"/></g>:null}
 {kind==="hilo"?<g transform="translate(106 30)"><rect width="65" height="105" rx="8" fill="#dce3e7" transform="rotate(-12 32 52)"/><text x="20" y="65" fill="#324550" fontFamily="Georgia" fontSize="38">7</text><rect x="60" y="23" width="65" height="105" rx="8" fill="#8494ae" transform="rotate(12 92 75)"/><path d="M92 99V53m-15 16 15-16 15 16" stroke="#e1e8ef" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/></g>:null}
 {kind==="roulette"?<g transform="translate(156 96) rotate(-18)"><circle r="76" fill="#1f3431" stroke="#bfa57a" strokeWidth="3"/>{Array.from({length:24},(_,i)=><path key={i} d="M0 -69 L0 -43" stroke={i%2?"#b87166":"#748f83"} strokeWidth="13" transform={"rotate("+i*15+")"}/>)}<circle r="38" stroke="#bfa57a"/><path d="M-28 0h56M0 -28v56" stroke="#bfa57a" strokeWidth="4"/><circle r="9" fill="#bfa57a"/><circle cx="21" cy="-55" r="5" fill="#f0eee5"/></g>:null}
 {kind==="plinko"?<g>{Array.from({length:7},(_,r)=>Array.from({length:r+2},(_,c)=><circle key={r+"-"+c} cx={151+(c-(r+1)/2)*19} cy={30+r*18} r="3" fill="#9baaa4"/>))}<circle cx="144" cy="69" r="9" fill="#d6ae70"/><path d="M91 162h120" stroke="#6a8e83" strokeWidth="12" strokeDasharray="17 4"/></g>:null}
 {kind==="mines"?<g transform="translate(99 25) rotate(12 60 65)">{Array.from({length:9},(_,i)=><rect key={i} x={i%3*40} y={Math.floor(i/3)*40} width="33" height="33" rx="6" fill="#29433c" stroke="#507466"/>)}<path d="m57 45 12 12-12 19-12-19Z" fill="#a2c7b1"/><path d="m17 5 12 12-12 19L5 17Z" fill="#a2c7b1"/></g>:null}
 {kind==="dice"?<g transform="translate(112 36) rotate(18 48 48)"><rect width="98" height="98" rx="19" fill="#dce3d8"/>{[[25,25],[73,25],[49,49],[25,73],[73,73]].map(([x,y])=><circle key={x+"-"+y} cx={x} cy={y} r="8" fill="#2d453a"/>)}</g>:null}
 {kind==="chicken"?<g>
 <path d="M111 0h126v180H82Z" fill="#222e2a"/><path d="m112 0-29 180M233 0l4 180" stroke="#8a9675" strokeWidth="3" opacity=".5"/>
 <path d="m170 0-5 35m-4 28-5 35m-4 28-6 45" stroke="#d6c79a" strokeWidth="3" strokeLinecap="round" opacity=".55"/>
 <g transform="translate(193 18) rotate(8)"><rect width="28" height="54" rx="9" fill="#78948a"/><rect x="4" y="10" width="20" height="13" rx="4" fill="#304d47"/><rect x="4" y="35" width="20" height="10" rx="3" fill="#3c5b52"/><path d="M4 4h6m8 0h6" stroke="#e6d7a8" strokeWidth="3"/></g>
 <ellipse cx="144" cy="157" rx="34" ry="9" fill="#14241c" opacity=".65"/>
 <path d="m130 140-5 16-8 1m32-17 3 16h10" stroke="#cc9a56" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
 <path d="M123 110c-18 0-24-12-22-22 7 1 16 8 21 13 3-12 13-22 25-22 18 0 31 18 27 36-3 18-14 29-31 29-19 0-30-17-20-34Z" fill="#e9dfbc"/>
 <path d="M130 114c3-11 17-12 25-5-2 17-17 24-25 5Z" fill="#cbbc94"/><path d="M156 97c-8-6-12-14-7-21l5 4c-3-11 5-17 10-9l2 6c8-6 13 0 8 9l-5 10Z" fill="#ac6250"/>
 <circle cx="160" cy="99" r="17" fill="#f2e7c7"/><path d="m175 97 15 7-16 6Z" fill="#d3a45b"/><path d="M169 111c9 0 10 12 3 13-7 0-7-7-3-13Z" fill="#ac6250"/><circle cx="165" cy="95" r="3.2" fill="#26372d"/><circle cx="166" cy="94" r="1" fill="#fff8e3"/>
 </g>:null}
 </svg>;
}
export default function GamesHub(){
 const {features}=useFeatures(),games=visibleHubGames(features);
 return <main className={styles.hub}><header className={styles.heading}><p>THE GAME ROOM</p><h1>Games</h1><span>Pick a table. Try your luck.</span></header>
 <div className={styles.grid}>{games.map(g=><Link key={g.key} href={g.href} className={styles.banner+" "+styles[g.art]}><Artwork kind={g.art}/><div className={styles.caption}><h2>{g.title}</h2><p>{g.detail}</p><span className={styles.play}>Play <span aria-hidden="true">↗</span></span></div></Link>)}</div>
 {!games.length?<p role="status" className={styles.empty}>The game room is taking a break. Please check back later.</p>:null}</main>;
}
