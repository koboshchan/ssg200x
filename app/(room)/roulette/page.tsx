import {FeatureNotice} from "../../feature-gate";
import {RoomView} from "../../room-client";
export default function Page(){return <><FeatureNotice feature="roulette"/><RoomView tab="roulette"/></>;}
