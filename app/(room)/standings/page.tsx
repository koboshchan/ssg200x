import FeatureGate from "../../feature-gate";
import {RoomView} from "../../room-client";
export default function Page(){return <FeatureGate feature="leaderboard"><RoomView tab="standings"/></FeatureGate>;}
