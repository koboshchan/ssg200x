// One account-wide queue: starts are at least gapMs apart (700ms ≈ 85/min), under the server's 120/min bucket.
export function createPacer(gapMs=700,now:()=>number=Date.now,sleep:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms))){
 let tail:Promise<unknown>=Promise.resolve(),last=-Infinity;
 return function paced<T>(fn:()=>Promise<T>):Promise<T>{
  const run=tail.then(async()=>{const wait=last+gapMs-now();if(wait>0)await sleep(wait);last=now();return fn();});
  tail=run.catch(()=>{});
  return run;
 };
}
