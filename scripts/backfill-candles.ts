import { backfillStep, backfillProgress } from "../lib/candles";
import { closeDatabase } from "../lib/db";
async function main() {
 console.log(await backfillStep());
 console.log(await backfillProgress());
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(closeDatabase);
