import type { Instrumentation } from "next";

// Runs ONCE per server instance, before the first request is served (Next.js
// instrumentation file convention). Two startup duties:
//
//   1. Bring up telemetry (Azure Monitor / Application Insights via OpenTelemetry)
//      FIRST, so its auto-instrumentation can patch the HTTP and mssql/tedious
//      modules before anything opens a connection. No-op when the connection
//      string is unset. Also records a content-free `app_started` event.
//   2. Apply pending Drizzle migrations to the app-owned `novedu_*` tables — the
//      server must never run against an older schema than its code expects.
//      Failures abort startup on purpose.
//   3. Create Mastra's `mastra_*` tables (`initMastraStorage`). Mastra would do
//      this itself, but only on the store's first use — and `lib/code-stats-store.ts`
//      reads those tables directly, so on a database where no agent has run yet
//      the teacher's stats panels would break first. Same fail-loud policy as (2).
//
// (There used to be a third duty here — hourly garbage collection of expired
// tutor codes. It was removed: codes and their conversation data now live until
// a teacher deletes them explicitly, so their stats stay reachable.)
//
// Needs Node.js (database driver + OTEL SDK); the edge/browser builds of this
// file do nothing. The dynamic imports keep those modules out of edge bundles.
// The no-DB case (MSSQL_CONNECTION_STRING unset, e.g. plain `next build`) skips
// migrations: the app boots for DB-less flows like tutor validation, matching
// the graceful degradation in app/mastra/index.ts. Telemetry is independent of
// the DB and gated on its own connection string.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { initTelemetry, emitEvent } = await import("@/lib/telemetry");
  await initTelemetry();
  emitEvent("app_started", { runtime: "nodejs" });

  if (!process.env.MSSQL_CONNECTION_STRING) {
    console.warn("instrumentation: MSSQL_CONNECTION_STRING not set — skipping migrations");
    return;
  }

  const { runMigrations } = await import("@/lib/db/migrate");
  await runMigrations();

  const { initMastraStorage } = await import("@/app/mastra");
  await initMastraStorage();
}

// Next calls this for EVERY uncaught server error — route handlers, server
// actions, and RSC renders alike — so one global hook records them without
// wrapping individual calls. This is the capture path for unhandled errors that
// auto-instrumentation misses (e.g. async DB-driver rejections). Node-only: the
// telemetry provider is initialized only in the Node runtime.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordError } = await import("@/lib/telemetry");
  recordError(err, { path: request.path, routeType: context.routeType });
};
