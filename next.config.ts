import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS?.split(",").map(host => host.trim()).filter(Boolean) ?? [],
  outputFileTracingIncludes: {"/*":["./server.mjs","./node_modules/socket.io/**/*","./node_modules/engine.io/**/*","./node_modules/@clerk/backend/**/*","./node_modules/@clerk/shared/**/*","./node_modules/mongodb/**/*"]},
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
