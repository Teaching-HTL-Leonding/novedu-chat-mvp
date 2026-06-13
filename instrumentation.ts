// Runs ONCE per server instance, before the first request is served (Next.js
// instrumentation file convention). Two startup duties, both about the
// app-owned `novedu_*` tables:
//
//  1. Apply pending Drizzle migrations — the server must never run against an
//     older schema than its code expects. Failures abort startup on purpose.
//  2. Start the hourly tutor-code garbage collection.
//
// Both need Node.js (database driver); the edge/browser builds of this file do
// nothing. Dynamic imports keep the database modules out of those bundles. The
// no-DB case (MSSQL_CONNECTION_STRING unset, e.g. plain `next build`) is
// skipped: the app boots for DB-less flows like tutor validation, matching the
// graceful degradation in app/mastra/index.ts.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.MSSQL_CONNECTION_STRING) {
    console.warn("instrumentation: MSSQL_CONNECTION_STRING not set — skipping migrations and GC");
    return;
  }

  const { runMigrations } = await import("@/lib/db/migrate");
  await runMigrations();

  const { startTutorCodeGc } = await import("@/lib/tutor-code-gc");
  startTutorCodeGc();
}
