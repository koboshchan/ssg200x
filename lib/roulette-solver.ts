import {Worker} from 'node:worker_threads';
import {join} from 'node:path';
import type {SolveInput,SolveResult} from '../runtime/roulette-solver.mjs';
export function solveRoulette(input:SolveInput):Promise<SolveResult>{
 return new Promise((resolve,reject)=>{
  const worker=new Worker(join(process.cwd(),'runtime/roulette-solver.mjs'),{workerData:input});
  const timeout=setTimeout(()=>{void worker.terminate();reject(new Error('Roulette solver timed out'));},120_000);
  let settled=false;
  worker.once('message',(message:{ok:boolean;value:SolveResult;error?:string})=>{settled=true;clearTimeout(timeout);if(message.ok)resolve(message.value);else reject(new Error(message.error));});
  worker.once('error',error=>{settled=true;clearTimeout(timeout);reject(error);});
  worker.once('exit',code=>{clearTimeout(timeout);if(!settled)reject(new Error('Roulette solver exited '+code));});
 });
}
