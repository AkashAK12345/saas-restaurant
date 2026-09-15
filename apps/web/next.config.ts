import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Only the browser suite sets NEXT_DIST_DIR (e2e/servers/web.ts), so its
  // production build never touches the dev server's .next or its lockfile.
  distDir: process.env.NEXT_DIST_DIR || ".next",

  // Do not advertise the framework.
  poweredByHeader: false,

  // Baseline hardening for every page. The staff app and the wall displays
  // are never meant to be framed by another site, sniffed as another type or
  // to use the camera, microphone or location. Data security is the API's
  // job; these stop the browser being turned against a signed-in operator.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
