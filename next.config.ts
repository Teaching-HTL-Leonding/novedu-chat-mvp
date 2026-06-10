import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mastra and the SQL Server driver stack must not be bundled by Next.js — they
  // are required at runtime instead. `tedious`/`mssql` rely on dynamic requires and
  // Node networking that don't survive bundling.
  // See https://mastra.ai/guides/getting-started/next-js
  serverExternalPackages: ["@mastra/*", "mssql", "tedious"],
};

export default nextConfig;
