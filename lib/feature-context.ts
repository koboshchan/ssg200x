import {resolveFeatures,type FeatureKey} from './feature-catalog';
import type {Room} from './types';
const flags=new WeakMap<Room,Record<FeatureKey,boolean>>();
export function bindRoomFeatures(room:Room,features:Record<FeatureKey,boolean>){flags.set(room,features);}
export function roomFeatureEnabled(room:Room|undefined,key:FeatureKey){return (room&&flags.get(room)||resolveFeatures())[key];}
