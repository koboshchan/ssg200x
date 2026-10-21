import React from "react";
import {createRoot} from "react-dom/client";
import CasinoLimitSettings from "../../app/casino-limit-settings";
import {RoomView} from "../../app/room-client";
createRoot(document.getElementById("root")!).render(<><section style={{padding:"24px",maxWidth:1000,margin:"auto"}}><p>ISOLATED POKER LIMITS DEMO · fake chips, no production data</p><CasinoLimitSettings/><p>Refresh after saving to read the latest limit at the table. Existing seats keep their chips.</p><button onClick={()=>location.reload()}>Refresh table</button></section><RoomView tab="table"/></>);
