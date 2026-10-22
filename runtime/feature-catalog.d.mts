export type FeatureKey="poker"|"blackjack"|"roulette"|"doudizhu"|"games"|"coinflip"|"dice"|"limbo"|"mines"|"plinko"|"crash"|"wheel"|"hilo"|"slots"|"keno"|"chicken"|"cryptoPerps"|"cryptoSpot"|"stocks"|"forex"|"polymarket"|"chat"|"tableTalk"|"dms"|"transfers"|"payments"|"airdrops"|"advancements"|"checkIn"|"leaderboard";
export const FEATURE_DEFAULTS:Readonly<Record<FeatureKey,boolean>>;
export const FEATURE_LABELS:Readonly<Record<FeatureKey,string>>;
export function resolveFeatures(raw?:Partial<Record<FeatureKey,boolean>>,env?:Record<string,string|undefined>):Record<FeatureKey,boolean>;
export function featureForPath(path:string):FeatureKey|null;
