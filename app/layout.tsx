import type {Metadata} from "next";
import {ClerkProvider} from "@clerk/nextjs";
import "./globals.css";
import RoomClient from "./room-client";
import {configured} from "@/lib/api";
export const metadata:Metadata={title:"ssg200x",description:"A private table for friends. No-limit hold’em, play-money chips, and a seat with your name on it."};
export default function RootLayout({children}:{children:React.ReactNode}) {
 const key=process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
 const body=<html lang="en" suppressHydrationWarning><head><meta charSet="utf-8"/></head><body><RoomClient configured={configured()}>{children}</RoomClient></body></html>;
 return key&&process.env.CLERK_SECRET_KEY?<ClerkProvider>{body}</ClerkProvider>:body;
}
