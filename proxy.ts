import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
const clerk = clerkMiddleware(async (auth, req) => {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Sign in with Google." }, { status: 401 });
  }
});
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  // /leaderboard stays public: clerkMiddleware below only reads the session so the page can show the
  // signed-in nav, and the page never blocks anonymous visitors. It is not behind the maintenance gate
  // (that lives in the (room) layout) and unconfigured Clerk falls through to NextResponse.next().
  // Independently authenticated with a per-process secret, never Clerk cookies.
  if(request.nextUrl.pathname==="/api/internal-live")return NextResponse.next();
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!key || key.includes("REPLACE") || !process.env.CLERK_SECRET_KEY) {
    if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Clerk setup required." }, { status: 503 });
    return NextResponse.next();
  }
  return clerk(request, event);
}
export const config = { matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|webmanifest)).*)", "/api/:path*"] };
