import React from "react";
import {createRoot} from "react-dom/client";
import RoomClient from "../../app/room-client";
import PokerPage from "../../app/(room)/poker/page";
import BlackjackPage from "../../app/(room)/blackjack/page";
import RoulettePage from "../../app/(room)/roulette/page";
import DoudizhuPage from "../../app/(room)/doudizhu/page";
import "../../app/globals.css";
const PAGES:Record<string,React.ComponentType>={"/poker":PokerPage,"/blackjack":BlackjackPage,"/roulette":RoulettePage,"/doudizhu":DoudizhuPage};
const NAV=[["poker","Poker"],["blackjack","Blackjack"],["roulette","Roulette"],["doudizhu","Doudizhu"],["pool","Pool"]];
function Nav(){const me=/(?:^|; )gc_user=(alice|bob)/.exec(document.cookie)?.[1];
 return <div style={{display:"flex",gap:12,padding:"6px 14px",fontSize:12,background:"#111",color:"#ccc",flexWrap:"wrap"}}><strong>FIXTURE DEMO, not production</strong>
  {NAV.map(([p,l])=><a key={p} href={"/"+p} style={{color:"#9cf"}}>{l}</a>)}<span style={{marginLeft:"auto"}}>you are {me??"nobody"}: <a style={{color:"#9cf"}} href="?user=alice">alice</a> <a style={{color:"#9cf"}} href="?user=bob">bob</a></span></div>;}
const path=location.pathname.replace(/\/$/,"")||"/";
const Page=PAGES[path];
createRoot(document.getElementById("root")!).render(<><Nav/>{Page?<RoomClient configured><Page/></RoomClient>:<p style={{padding:24}}>Pick a game above.</p>}</>);
