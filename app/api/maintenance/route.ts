import {endpoint} from "@/lib/api";
import {siteMaintenance} from "@/lib/site-maintenance";
export const dynamic="force-dynamic";
export const GET=(request:Request)=>endpoint(request,async who=>siteMaintenance(who.admin));
