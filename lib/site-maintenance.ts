import {readRoom} from "./db";
import {maintenancePolicy} from "./maintenance-policy";
export async function siteMaintenance(admin:boolean){
 const room=await readRoom();
 return {...maintenancePolicy(admin,room.siteMaintenance===true),admin};
}
