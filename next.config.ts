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
  // A quiz answer may carry up to 3 photos of 5 MB each as base64 data URLs
  // (~20 MB inflated) through the quiz server actions — raise the default 1 MB
  // body limit with headroom. Global to ALL server actions; accepted by design.
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
  // Code creation lives at `/codes/new` (the list page owns the "New code"
  // button). The old share entry points 308-redirect there so any lingering link
  // still lands somewhere useful (the teacher re-picks the file/module).
  async redirects() {
    return [
      { source: "/share-tutor", destination: "/codes/new", permanent: true },
      { source: "/share-quiz", destination: "/codes/new", permanent: true },
    ];
  },
  // The teacher guide is a static Astro export in public/docs/ (built with
  // base '/docs' — see teacher-docs-site/ and docs/teacher-docs.md). Next's
  // public/ serving is exact-path only, so these afterFiles rewrites supply the
  // directory-index resolution a static host would: they run only when no real
  // file matched, so /docs/_astro/*.css and friends are untouched, while
  // /docs/<chapter> lands on the exported <chapter>/index.html. (Astro's
  // trailing-slash links first hit Next's own /docs/x/ → /docs/x 308.)
  async rewrites() {
    return {
      afterFiles: [
        { source: "/docs", destination: "/docs/index.html" },
        { source: "/docs/:path+", destination: "/docs/:path+/index.html" },
      ],
    };
  },
};

export default nextConfig;
