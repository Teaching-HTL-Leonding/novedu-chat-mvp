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
  // The "Create Tutor Code" flow moved from `/share-tutor` to `/tutor-codes/new`
  // (the list page now owns the "New Tutor Code" button). Keep old links/bookmarks
  // working; the `?tutor=` query is preserved by default.
  async redirects() {
    return [{ source: "/share-tutor", destination: "/tutor-codes/new", permanent: true }];
  },
};

export default nextConfig;
