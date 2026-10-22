import React from "react";
import {createRoot} from "react-dom/client";
import FeatureSettings from "../../app/feature-settings";
import MarketSymbolSettings from "../../app/market-symbol-settings";
import ReleaseProvider,{useRelease} from "../../app/release-provider";
import {useEffect} from "react";
import {FeatureNotice} from "../../app/feature-gate";
// Stand-in for the socket "features:state" event: poll the mock and feed the real observer.
function MockSocket(){const r=useRelease();useEffect(()=>{const t=setInterval(async()=>{r.observeFeatures(await (await fetch("/api/features")).json());},500);return()=>clearInterval(t);},[r]);return null;}
function Demo(){
 return <><header className="mast" style={{position:"static"}}><span className="wordmark">ssg200x</span><strong>ISOLATED COMPONENT DEMO, not the main app</strong></header>
 <main className="game-main" style={{padding:24}}><p className="fine">Real FeatureSettings and MarketSymbolSettings components against in-memory mock APIs. No auth, providers or database. State resets when the demo server restarts.</p>
 <FeatureSettings/><MarketSymbolSettings/>
 <h2>Player banner (live from flags)</h2><FeatureNotice feature="stocks"/><FeatureNotice feature="forex"/><FeatureNotice feature="polymarket"/></main></>;
}
createRoot(document.getElementById("root")!).render(<ReleaseProvider><MockSocket/><Demo/></ReleaseProvider>);
