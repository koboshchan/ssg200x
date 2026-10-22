"use client";
import {FEATURE_LABELS,type FeatureKey} from "@/lib/feature-catalog";
import {useFeatures} from "./use-features";
export function FeatureDisabled({feature}:{feature:FeatureKey}){
 return <main className="game-main feature-disabled"><h1>{FEATURE_LABELS[feature]}</h1><p role="status">Temporarily disabled</p><p className="fine">This section is switched off for now. Please check back later.</p></main>;
}
export default function FeatureGate({feature,children}:{feature:FeatureKey|FeatureKey[];children:React.ReactNode}){
 const {features}=useFeatures(),keys=Array.isArray(feature)?feature:[feature],off=keys.find(k=>features[k]===false);
 return off?<FeatureDisabled feature={off}/>:<>{children}</>;
}
/** For market-style pages: show everything, but when all listed features are off show the disabled state. */
export function FeatureGateAny({feature,children}:{feature:FeatureKey[];children:React.ReactNode}){
 const {features}=useFeatures();
 return feature.every(k=>features[k]===false)?<FeatureDisabled feature={feature[0]}/>:<>{children}</>;
}
const ENTRY_GAMES:FeatureKey[]=["poker","blackjack","roulette","doudizhu","games","plinko","hilo","mines","dice","chicken"];
/** Banner for pages with existing positions or rounds: new entries are off, exits stay usable. */
export function FeatureNotice({feature}:{feature:FeatureKey|FeatureKey[]}){
 const {features}=useFeatures(),off=(Array.isArray(feature)?feature:[feature]).filter(k=>features[k]===false);
 if(!off.length)return null;
 const game=off.every(k=>ENTRY_GAMES.includes(k)),names=off.map(k=>FEATURE_LABELS[k]).join(", ");
 return <p className="feature-notice" role="status"><strong>{names}: temporarily disabled.</strong> {game?"New rounds and entries are off. Anything already in progress can still be finished or cashed out.":off.includes("payments")?"Sending money is off.":"New orders are off. Existing positions and holdings remain visible. Closing requires fresh prices and may wait until this market is re-enabled."}</p>;
}
