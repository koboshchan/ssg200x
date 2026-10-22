import {FeatureNotice} from "../../feature-gate";
import GamesClient from "../../games-client";
export default function Page(){return <><FeatureNotice feature={["games","plinko","hilo","mines","dice","chicken"]}/><GamesClient/></>;}
