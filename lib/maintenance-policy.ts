export function maintenancePolicy(admin:boolean,manual:boolean,backfill:boolean,background=false){
 const active=manual||(backfill&&!background);
 return {active,blocked:!admin&&active,manual,backfill,background};
}
