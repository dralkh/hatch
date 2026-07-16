import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a minimal, self-contained Node server for Docker/self-hosting while
  // retaining the regular Worker artifact used by the Cloudflare deployment.
  output: "standalone",
};

export default nextConfig;
