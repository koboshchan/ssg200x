import {RED} from '@/lib/market-shared';
const pockets=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const point=(radius:number,angle:number)=>[160+radius*Math.sin(angle),160-radius*Math.cos(angle)];
/** Original vector wheel. Decorative motion never predicts the server result. */
export default function RouletteWheel({last,locked}:{last?:number;locked:boolean}){
 const step=Math.PI*2/37;
 return <svg viewBox="0 0 320 320" role="img" aria-label={last===undefined?'European roulette wheel':'European roulette wheel, last result '+last}>
 <defs><radialGradient id="roulette-wood"><stop stopColor="#94704e"/><stop offset=".7" stopColor="#503c2d"/><stop offset="1" stopColor="#b39a73"/></radialGradient><radialGradient id="roulette-bowl"><stop stopColor="#dae1e3"/><stop offset=".65" stopColor="#bbc6cb"/><stop offset="1" stopColor="#65777e"/></radialGradient></defs>
 <circle cx="160" cy="160" r="158" fill="url(#roulette-wood)"/><circle cx="160" cy="160" r="148" fill="#d5c9a8"/>
 {pockets.map((n,i)=>{const start=(i-.5)*step,end=(i+.5)*step,a=point(145,start),b=point(145,end),c=point(112,end),d=point(112,start);return <g key={n}><path d={`M${a.join(' ')} A145 145 0 0 1 ${b.join(' ')} L${c.join(' ')} A112 112 0 0 0 ${d.join(' ')} Z`} fill={n===0?'#33845d':RED.has(n)?'#b74347':'#26323a'} stroke="#e0d5bb" strokeWidth=".6"/><text x="160" y="28" transform={`rotate(${i*360/37} 160 160)`} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="10" fontFamily="sans-serif">{n}</text></g>;})}
 <circle cx="160" cy="160" r="110" fill="url(#roulette-bowl)" stroke="#e5d7b3" strokeWidth="3"/><circle cx="160" cy="160" r="83" fill="#34535e" stroke="#81949a" strokeWidth="2"/>
 {Array.from({length:12},(_,i)=><path key={i} d="M160 81 L160 118" transform={`rotate(${i*30} 160 160)`} stroke="#acb9bc" strokeWidth="1" opacity=".65"/>)}
 <circle cx="160" cy="160" r="50" fill="#41626d"/><path d="M115 160 H205 M160 115 V205" stroke="#d6c7a7" strokeWidth="8" strokeLinecap="round"/><circle cx="160" cy="160" r="16" fill="#f5ebd4" stroke="#a99a78" strokeWidth="3"/>
 <g className={locked?'roulette-ball-moving':undefined} style={{transformOrigin:'160px 160px'}} transform={locked?undefined:`rotate(${last===undefined?25:pockets.indexOf(last)*360/37} 160 160)`}><circle cx="160" cy="43" r="4.5" fill="#fff" stroke="#cbd1d2"/></g>
 </svg>;
}
