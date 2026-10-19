import RoomClient from "./room-client";
import {configured} from "@/lib/api";
export const dynamic="force-dynamic";
export default function Page(){return <RoomClient configured={configured()}/>;}
