// One bounded selection per authenticated socket. Exact allowlisting also happens
// in the internal route before any database query. This handler never fetches.
export function subscribeChart(socket,selection,now=Date.now()){
 if(selection===null){socket.data.chart=undefined;socket.data.chartFingerprint=undefined;socket.data.chartChangeAt=0;return;}
 if(now<(socket.data.chartChangeAt||0))return;
 if(!selection||typeof selection!=="object"||Array.isArray(selection)||Object.keys(selection).length!==2||
  typeof selection.symbol!=="string"||!/^[A-Z]{2,8}$/.test(selection.symbol)||
  !["1m","5m","15m","1h","6h","1d"].includes(selection.granularity))return;
 socket.data.chart={symbol:selection.symbol,granularity:selection.granularity};
 socket.data.chartFingerprint=undefined;socket.data.chartChangeAt=now+100;
 socket.data.statusAt=0;
}
export function emitChartState(socket,data){
 if(data.maintenance.blocked||!data.candles?.candles)return;
 const selected=socket.data.chart,payload=data.candles;
 if(!selected||selected.symbol!==payload.symbol||selected.granularity!==payload.granularity)return;
 const fingerprint=JSON.stringify(payload);
 if(socket.data.chartFingerprint===fingerprint)return;
 socket.emit("candles:state",payload);socket.data.chartFingerprint=fingerprint;
}
