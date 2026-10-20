import {createHash} from 'node:crypto';
import {zipSync,strToU8} from 'fflate';
import {backfillStep} from '../../lib/candles';
import {siteMaintenance} from '../../lib/site-maintenance';
import {closeDatabase} from '../../lib/db';
if(!process.env.MONGODB_DB?.startsWith('fakebucks_test_restart_'))throw Error('Isolated restart database required');
const urls:string[]=[];
globalThis.fetch=(async(input:unknown)=>{
 const url=String(input);urls.push(url);
 if(process.env.CRASH_AT_FETCH==='1'){
  process.send?.({fetch:url});
  return new Promise(()=>{});
 }
 if(!url.includes('/ETHUSDT/'))throw Error(`Unexpected completed-job download ${url}`);
 const period=url.match(/ETHUSDT-1m-(\d{4}-\d{2})/)![1],time=Date.parse(period+'-15T00:00:00Z');
 const zip=zipSync({'ETHUSDT.csv':strToU8([time*1000,10,15,8,12,2].join(','))});
 return url.endsWith('.CHECKSUM')?new Response(createHash('sha256').update(zip).digest('hex')+' file.zip'):new Response(zip);
}) as typeof fetch;
async function main(){const result=await backfillStep();console.log(JSON.stringify({result,urls,maintenance:await siteMaintenance(false)}));await closeDatabase();}
main().catch(e=>{console.error(e);process.exit(1)});
