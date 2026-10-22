export function createFeatureRevisionObserver(onChange:(revision:number)=>void):(payload:unknown)=>void;
export function createFeatureRevisionCheck(observe:(payload:unknown)=>void,fetcher?:typeof fetch):()=>Promise<void>;
