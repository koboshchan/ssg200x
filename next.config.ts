import type { NextConfig } from "next";
import {pokerKickDemoEnabled} from "./lib/poker-kick-demo";
const config: NextConfig = {
  output: "standalone",
  // A copied public demo flag must never expose the trigger in a normal build.
  env: {
    NEXT_PUBLIC_POKER_KICK_DEMO: process.env.NEXT_PUBLIC_POKER_KICK_DEMO === "1" && pokerKickDemoEnabled() ? "1" : "0",
    NEXT_PUBLIC_SSG_GIT_COMMIT: process.env.SSG_GIT_COMMIT || "unknown",
  },
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS?.split(",").map(host => host.trim()).filter(Boolean) ?? [],
  outputFileTracingIncludes: {"/*":["./server.mjs","./runtime/**/*","./node_modules/socket.io/**/*","./node_modules/engine.io/**/*","./node_modules/@clerk/backend/**/*","./node_modules/@clerk/shared/**/*","./node_modules/mongodb/**/*"]},
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ] }];
  },
};
export default config;
