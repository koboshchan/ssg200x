/** Only an explicit administrator switch closes the site. Legacy job records are inert. */
export function maintenancePolicy(admin:boolean,manual:boolean){
 return {active:manual,blocked:!admin&&manual,manual};
}
