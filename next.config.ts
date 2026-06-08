import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mastra (and its native deps like @libsql) must not be bundled by Next.js —
  // they are required at runtime instead. See https://mastra.ai/guides/getting-started/next-js
  serverExternalPackages: ["@mastra/*"],
};

export default nextConfig;
