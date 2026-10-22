import {FeatureNotice} from "../../feature-gate";
import Doudizhu from "../../doudizhu-client";
export default function Page(){return <><FeatureNotice feature="doudizhu"/><Doudizhu/></>;}
