import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server (.next/standalone) for the Docker image — see
  // Dockerfile. Only traced files end up in the image, not the full node_modules.
  output: "standalone",
  // Mastra and the SQL Server driver stack must not be bundled by Next.js — they
  // are required at runtime instead. `tedious`/`mssql` rely on dynamic requires and
  // Node networking that don't survive bundling.
  // See https://mastra.ai/guides/getting-started/next-js
  //
  // `@azure/monitor-opentelemetry` (the OTEL distro, loaded in instrumentation.ts)
  // must also stay external: its auto-instrumentation patches modules at require
  // time, which only works when those modules load through Node's loader rather
  // than a bundle.
  serverExternalPackages: ["@mastra/*", "mssql", "tedious", "@azure/monitor-opentelemetry"],
};

export default nextConfig;
