export function subscribeMarket(socket:{data:Record<string,any>},symbol:unknown):void;
export function scopeMarketRoom<T extends {quotes?:unknown;marketChanges?:unknown;stockExecution?:unknown}>(room:T,symbol?:string):T;
