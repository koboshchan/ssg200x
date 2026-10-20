import React from "react";
import {createRoot} from "react-dom/client";
import Wallet from "../../app/(room)/wallet/page";
import LiveProvider from "../../app/live-provider";
const root=createRoot(document.getElementById("root")!);
const mount=()=>root.render(<LiveProvider><Wallet/></LiveProvider>);
Object.assign(window,{walletHarness:{mount,unmount:()=>root.unmount()}});
mount();
