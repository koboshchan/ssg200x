export function maintenancePolicy(admin:boolean,manual:boolean,backfill:boolean){
 return {active:manual||backfill,blocked:!admin&&(manual||backfill),manual,backfill};
}
