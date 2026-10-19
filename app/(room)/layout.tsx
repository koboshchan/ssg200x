import RoomClient from "../room-client";
import {configured} from "@/lib/api";
export const dynamic="force-dynamic";
export default function RoomLayout({children}:{children:React.ReactNode}){return <RoomClient configured={configured()}>{children}</RoomClient>;}
