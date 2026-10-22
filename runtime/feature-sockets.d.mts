import type {FeatureKey} from './feature-catalog.mjs';
export function socketFeature(event:string,payload:unknown):FeatureKey[];
export function attachFeatureSocket(socket:{use:(handler:(packet:any[],next:()=>void)=>void)=>void},settings:{enabled:(key:FeatureKey)=>boolean}):void;
