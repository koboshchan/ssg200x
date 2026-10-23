import type {Metadata} from "next";
import {ClerkProvider} from "@clerk/nextjs";
import "./globals.css";
import "./advancements.css";
import ReleaseProvider from "./release-provider";
import QaFixtureProvider from "./qa-fixture-provider";
import {fixtureMode} from "@/lib/qa-chart-fixture";
import RoomClient from "./room-client";
import {configured} from "@/lib/api";
import {clerkKeys} from "@/lib/clerk-env";
// Keys come from the container environment at request time; never prerender a configured/unconfigured freeze.
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"ssg200x",icons:{icon:"/favicon.ico"},description:"A private table for friends. No-limit hold’em, play-money chips, and a seat with your name on it."};
export default function RootLayout({children}:{children:React.ReactNode}) {
 const keys=clerkKeys();
 const body=<html lang="en" suppressHydrationWarning><head><meta charSet="utf-8"/></head><body><QaFixtureProvider enabled={fixtureMode()}><ReleaseProvider><RoomClient configured={configured()}>{children}</RoomClient></ReleaseProvider></QaFixtureProvider></body></html>;
 return keys?<ClerkProvider publishableKey={keys.publishableKey}>{body}</ClerkProvider>:body;
}
