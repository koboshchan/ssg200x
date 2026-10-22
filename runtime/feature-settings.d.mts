import type {FeatureKey} from './feature-catalog.mjs';
export type Features=Readonly<Record<FeatureKey,boolean>>;
export type FeatureSettings={ready:Promise<Features>;refresh:()=>Promise<Features>;current:()=>Features;enabled:(key:FeatureKey)=>boolean;subscribe:(listener:(features:Features,previous:Features)=>void)=>()=>void;stop:()=>void};
export function createFeatureSettings(collection:{findOne:(filter:{_id:string})=>Promise<any>},options?:{env?:Record<string,string|undefined>;pollMs?:number;onError?:(error:unknown)=>void}):FeatureSettings;
export function getFeatureSettings(collection?:{findOne:(filter:{_id:string})=>Promise<any>},options?:{env?:Record<string,string|undefined>;pollMs?:number;onError?:(error:unknown)=>void}):FeatureSettings;
