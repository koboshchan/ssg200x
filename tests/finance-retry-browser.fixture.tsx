import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {usePendingFinance} from "../app/use-pending-finance";
function App(){
 const [connected,setConnected]=useState(true),[room,setRoom]=useState<any>(null);
 const controller=usePendingFinance("browser-test",connected,setRoom);
 const submit=()=>controller?.submit({type:"open",symbol:"BTC",side:"long",margin:10000,leverage:5,expectedOpeningFeePpm:300,expectedClosingFeePpm:300},Date.now());
 return <main><button id="connection" onClick={()=>setConnected(v=>!v)}>{connected?"Disconnect":"Reconnect"}</button>
 <button id="open" disabled={!controller?.ready} onClick={()=>void submit()}>Open</button>
 <button id="check" disabled={!connected||controller?.working} onClick={()=>void controller?.sync()}>Check again</button>
 <p id="state">{controller?.ready?"Ready":"Paused"}</p><p id="message">{controller?.message}{controller?.error}</p>
 <p id="positions">{room?.members?.[0]?.positions?.length??0}</p></main>;
}
function Fixture(){const [mounted,setMounted]=useState(true);return <><button id="mount" onClick={()=>setMounted(v=>!v)}>Change route</button>{mounted?<App/>:<p>Other route</p>}</>;}
createRoot(document.getElementById("root")!).render(<Fixture/>);
