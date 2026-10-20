import { clerkMiddleware, currentUser } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { clerkKeys } from "@/lib/clerk-env";
const publicPages = new Set(["/", "/leaderboard", "/privacy", "/terms"]);
// Options are resolved per request so the keys come from the runtime environment, never the build.
const clerk = clerkMiddleware(async (auth, req) => {
  const path = req.nextUrl.pathname;
  if (publicPages.has(path)) return;
  const { userId } = await auth();
  if (!userId) return path.startsWith("/api/")
    ? NextResponse.json({ error: "Sign in with Google." }, { status: 401 })
    : NextResponse.redirect(new URL("/", req.url));
  if (path === "/players" || path.startsWith("/players/") || path === "/admin" || path.startsWith("/admin/")) {
    const user = await currentUser();
    if (user?.privateMetadata?.admin !== true) return new NextResponse("Not found", { status: 404 });
  }
}, () => {
  // Only the publishable key is passed dynamically. A dynamic secretKey option would demand a separate
  // CLERK_ENCRYPTION_KEY; Clerk reads CLERK_SECRET_KEY from the runtime server environment itself.
  const keys = clerkKeys();
  return keys ? { publishableKey: keys.publishableKey } : {};
});
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  // /leaderboard stays public: clerkMiddleware below only reads the session so the page can show the
  // shared root shell can show signed-in nav, and anonymous visitors remain public. The root shell
  // excludes public routes from maintenance; unconfigured Clerk falls through to NextResponse.next().
  // Independently authenticated with a per-process secret, never Clerk cookies.
  if(request.nextUrl.pathname==="/api/internal-live")return NextResponse.next();
  if (!clerkKeys()) {
    if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Clerk setup required." }, { status: 503 });
    if (!publicPages.has(request.nextUrl.pathname)) return new NextResponse("Authentication unavailable", { status: 503 });
    return NextResponse.next();
  }
  return clerk(request, event);
}
export const config = { matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|webmanifest)).*)", "/api/:path*"] };
