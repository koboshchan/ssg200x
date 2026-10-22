import {createRoot} from "react-dom/client";
import {useState} from "react";
import Doudizhu from "../app/doudizhu-client";
import "../app/globals.css";
function Demo(){const [seat,setSeat]=useState(sessionStorage.getItem("dd-demo-seat")||"0");return <><header className="mast dd-demo-mast"><strong>ssg200x · Dou Dizhu demo</strong><label>Test player <select aria-label="Test player" value={seat} onChange={e=>{sessionStorage.setItem("dd-demo-seat",e.target.value);location.reload();}}>{["You","Mochi","Dango"].map((name,i)=><option key={i} value={i}>{name}</option>)}</select></label></header><p style={{margin:"16px 5%",fontSize:12,color:"var(--muted)"}}>Isolated demo with fictional play-money accounts. Same room engine and interface, not the production server.</p><div className="dd-demo-fx" role="group" aria-label="Visual effect previews (demo only, no game state)">{["deal","landlord","multiplier","bomb","rocket","airplane","spring","win","lose"].map(k=><button key={k} type="button" onClick={()=>window.dispatchEvent(new CustomEvent("dd-fx-preview",{detail:{kind:k}}))}>Preview {k}</button>)}</div><Doudizhu fxPreview/></>;}
const original=window.fetch.bind(window);window.fetch=(input,init={})=>original(input,{...init,headers:{...init.headers,"x-demo-seat":sessionStorage.getItem("dd-demo-seat")||"0"}});
createRoot(document.getElementById("root")!).render(<Demo/>);
