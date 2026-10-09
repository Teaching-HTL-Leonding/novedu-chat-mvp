import type { NextConfig } from "next";
import { TEACHER_GUIDE_URL } from "./lib/teacher-guide";

const nextConfig: NextConfig = {
  // Emit a self-contained server (.next/standalone) for the Docker image — see
  // Dockerfile. Only traced files end up in the image, not the full node_modules.
  output: "standalone",
  // Mastra and the Postgres driver must not be bundled by Next.js — they are
  // required at runtime instead. `pg` does an optional `require("pg-native")`
  // that a bundler would try (and fail) to resolve, and it needs Node
  // networking that doesn't survive bundling.
  // See https://mastra.ai/guides/getting-started/next-js
  //
  // The telemetry SDKs (loaded via lib/telemetry.ts from instrumentation.ts)
  // must also stay external: `@azure/monitor-opentelemetry` and the standard
  // `@opentelemetry/*` SDK + instrumentations patch modules at require time,
  // which only works when those modules load through Node's loader rather than
  // a bundle. Both backends share the HTTP and `pg` instrumentation packages;
  // the OTLP path adds `instrumentation-runtime-node` (docs/telemetry.md).
  serverExternalPackages: [
    "@mastra/*",
    "pg",
    "@azure/monitor-opentelemetry",
    "@opentelemetry/sdk-node",
    "@opentelemetry/instrumentation-http",
    "@opentelemetry/instrumentation-pg",
    "@opentelemetry/instrumentation-runtime-node",
  ],
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
  // The teacher guide lives on its own host; its former /docs paths map one to
  // one onto it (chapters, .md twins, llms.txt). Redirects run before proxy.ts,
  // so they reach signed-out visitors and agents without a matcher exclusion.
  async redirects() {
    return [
      { source: "/share-tutor", destination: "/codes/new", permanent: true },
      { source: "/share-quiz", destination: "/codes/new", permanent: true },
      { source: "/docs", destination: `${TEACHER_GUIDE_URL}/`, permanent: true },
      { source: "/docs/:path*", destination: `${TEACHER_GUIDE_URL}/:path*`, permanent: true },
    ];
  },
};

export default nextConfig;
