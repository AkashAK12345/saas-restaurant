import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Only the browser suite sets NEXT_DIST_DIR (e2e/servers/web.ts), so its
  // production build never touches the dev server's .next or its lockfile.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
