import {FeatureNotice} from "../../feature-gate";
import PolymarketClient from "../../polymarket-client";
export default function Page(){return <><FeatureNotice feature="polymarket"/><PolymarketClient/></>;}
