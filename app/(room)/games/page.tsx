import {FeatureNotice} from "../../feature-gate";
import GamesClient from "../../games-client";
import GamesHub from "../../games-hub";
const kinds=["plinko","hilo","mines","dice","chicken"] as const;
export default async function Page({searchParams}:{searchParams:Promise<{game?:string}>}){
 const {game}=await searchParams;
 const kind=kinds.find(k=>k===game);
 return kind?<><FeatureNotice feature={["games",kind]}/><GamesClient initialKind={kind}/></>:<GamesHub/>;
}
