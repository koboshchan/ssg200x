import FeatureGate from "../../feature-gate";
import AdvancementsClient from "../../advancements-client";
export default function Page(){return <FeatureGate feature="advancements"><AdvancementsClient/></FeatureGate>;}
