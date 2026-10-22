import React from "react";
import {createRoot} from "react-dom/client";
import FeatureSettings from "../../app/feature-settings";
import MarketSymbolSettings from "../../app/market-symbol-settings";
import {FeatureNotice} from "../../app/feature-gate";
function Demo(){
 return <><header className="mast" style={{position:"static"}}><span className="wordmark">ssg200x</span><strong>ISOLATED COMPONENT DEMO, not the main app</strong></header>
 <main className="game-main" style={{padding:24}}><p className="fine">Real FeatureSettings and MarketSymbolSettings components against in-memory mock APIs. No auth, providers or database. State resets when the demo server restarts.</p>
 <FeatureSettings/><MarketSymbolSettings/>
 <h2>Player banner (live from flags)</h2><FeatureNotice feature="stocks"/><FeatureNotice feature="forex"/><FeatureNotice feature="polymarket"/></main></>;
}
createRoot(document.getElementById("root")!).render(<Demo/>);
