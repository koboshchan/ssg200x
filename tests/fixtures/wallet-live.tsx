import React from "react";
import {createRoot} from "react-dom/client";
import Wallet from "../../app/(room)/wallet/page";
import ReleaseProvider from "../../app/release-provider";
import LiveProvider from "../../app/live-provider";
const root=createRoot(document.getElementById("root")!);
const mount=()=>root.render(<ReleaseProvider><LiveProvider><Wallet/></LiveProvider></ReleaseProvider>);
Object.assign(window,{walletHarness:{mount,unmount:()=>root.unmount()}});
mount();
