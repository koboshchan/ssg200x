import {readRoom} from "./db";
import {historyMaintenanceActive} from "./candles";
import {maintenancePolicy} from "./maintenance-policy";
export async function siteMaintenance(admin:boolean){
 const [room,backfill]=await Promise.all([readRoom(),historyMaintenanceActive()]);
 return {...maintenancePolicy(admin,room.siteMaintenance===true,backfill),admin};
}
