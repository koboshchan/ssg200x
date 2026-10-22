import {notFound} from "next/navigation";
import {FeatureNotice} from "../../../feature-gate";
import GamesClient from "../../../games-client";
const kinds=["plinko","hilo","mines","dice","chicken"] as const;
export default async function Page({params}:{params:Promise<{game:string}>}){
 const {game}=await params,kind=kinds.find(k=>k===game);
 if(!kind)notFound();
 return <><FeatureNotice feature={["games",kind]}/><GamesClient initialKind={kind} singleGame/></>;
}
