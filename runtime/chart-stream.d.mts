type Socket={data:Record<string,any>;emit:(event:string,payload:unknown)=>unknown};
export function subscribeChart(socket:Socket,selection:unknown,now?:number):void;
export function emitChartState(socket:Socket,data:{maintenance:{blocked:boolean};candles?:{symbol:string;granularity:string;candles:unknown[]}|null},force?:boolean):void;
