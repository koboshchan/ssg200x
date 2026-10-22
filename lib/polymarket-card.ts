export function liveCardMarkets<T extends {closed?:boolean;resolved?:boolean;outcomes:{label:string;price:number}[]}>(markets:T[]){
 const price=(m:T)=>m.outcomes.find(o=>/^yes$/i.test(o.label))?.price??m.outcomes[0]?.price??0;
 return markets.filter(m=>!m.closed&&!m.resolved).sort((a,b)=>price(b)-price(a));
}
