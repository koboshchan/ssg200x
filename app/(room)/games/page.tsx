import {redirect} from "next/navigation";
import GamesHub from "../../games-hub";
const kinds=["plinko","hilo","mines","dice","chicken"] as const;
export default async function Page({searchParams}:{searchParams:Promise<{game?:string}>}){
 const {game}=await searchParams;
 if(kinds.some(k=>k===game))redirect("/games/"+game);
 return <GamesHub/>;
}
