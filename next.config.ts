import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@upstash/redis", "@neondatabase/serverless"],
};

export default nextConfig;
