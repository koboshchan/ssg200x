import {createRoot} from "react-dom/client";
import {useRef,useState} from "react";
import "../app/globals.css";
import Doudizhu from "../app/doudizhu-client";
import {ReactionEffectLayer,useReactionEffects,isValidReaction,type ReactionSeat} from "../app/poker-taunts";
const NAMES=["Sora","Mochi","Dango"];
const seatOf=()=>sessionStorage.getItem("dd-demo-seat")||"0";
const original=window.fetch.bind(window);
window.fetch=(input,init={})=>original(input,{...init,headers:{...(init as RequestInit).headers,"x-demo-seat":seatOf()}});
async function fixture(scenario:string){await original("/__fixture",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({scenario})});location.reload();}
const nav=()=><nav style={{display:"flex",gap:12,margin:"8px 5%",fontSize:13}}><a href="#ddz">Dou Dizhu</a><a href="#poker">Poker receiver preview</a></nav>;
function DdzPage(){const [seat,setSeat]=useState(seatOf());
 return <><header className="mast dd-demo-mast"><strong>ssg200x · isolated demo</strong><label>Test player <select aria-label="Test player" value={seat} onChange={e=>{sessionStorage.setItem("dd-demo-seat",e.target.value);setSeat(e.target.value);location.reload();}}>{NAMES.map((n,i)=><option key={i} value={i}>{n}</option>)}</select></label></header>{nav()}
 <p style={{margin:"8px 5%",fontSize:12,color:"var(--muted)"}}>Fictional play-money accounts, isolated Mongo fixture, not production.</p>
 <div className="dd-demo-fx" role="group" aria-label="Fixture scenarios (demo only)">{(["doubling","poor","playing","reset"] as const).map(s=><button key={s} type="button" onClick={()=>fixture(s)}>Scenario {s}</button>)}</div>
 <Doudizhu/></>;}
const seats:ReactionSeat[]=[{publicId:"fx-sora",name:"Sora",isYou:true},{publicId:"fx-mochi",name:"Mochi"},{publicId:"fx-dango",name:"Dango"}];
let n=0;
function PokerPage(){const [hide,setHide]=useState(false);const {effects,add}=useReactionEffects(hide);const wrap=useRef<HTMLDivElement>(null);
 const send=(value:string,target:number)=>{const e={id:"fx-"+Date.now()+"-"+(n++),kind:"throw" as const,value,source:1,sourceId:seats[1]!.publicId,target,targetId:seats[target]!.publicId};if(!hide&&isValidReaction(e,3))add(e);};
 return <><header className="mast"><strong>ssg200x · isolated demo</strong></header>{nav()}
 <p style={{margin:"8px 5%",fontSize:12,color:"var(--muted)"}}>Fixture of the shared production reaction overlay, not the full poker engine. You are Sora (seat 0); Mochi (seat 1) is the sender.</p>
 <label style={{display:"block",margin:"8px 5%",fontSize:13}}><input type="checkbox" checked={hide} onChange={e=>setHide(e.target.checked)}/> Hide reactions</label>
 <div style={{display:"flex",flexWrap:"wrap",gap:8,margin:"8px 5%"}}><button type="button" onClick={()=>send("egg",0)}>Throw egg at me</button><button type="button" onClick={()=>send("tomato",0)}>Throw tomato at me</button><button type="button" onClick={()=>send("egg",2)}>Throw egg at another seat</button></div>
 <div ref={wrap} style={{position:"relative",height:320,margin:"16px 5%",borderRadius:16,background:"#14301f",display:"flex",justifyContent:"space-around",alignItems:"center"}}>
 {seats.map((s,i)=><div key={i} data-poker-seat={i} style={{textAlign:"center",color:"#fff"}}><div className="seat-top" style={{width:56,height:56,borderRadius:"50%",background:"#ffffff22",display:"grid",placeItems:"center"}}>{s!.name[0]}</div><div style={{fontSize:12,marginTop:4}}>{s!.name}{s!.isYou?" (you)":""}</div></div>)}
 <ReactionEffectLayer effects={effects} seats={seats} wrapper={wrap}/></div></>;}
function App(){const [h,setH]=useState(location.hash);useState(()=>{addEventListener("hashchange",()=>setH(location.hash));});return h==="#poker"?<PokerPage/>:<DdzPage/>;}
createRoot(document.getElementById("root")!).render(<App/>);
