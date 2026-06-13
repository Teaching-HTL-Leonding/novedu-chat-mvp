// Runs ONCE per server instance, before the first request is served (Next.js
// instrumentation file convention). One startup duty about the app-owned
// `novedu_*` tables: apply pending Drizzle migrations — the server must never
// run against an older schema than its code expects. Failures abort startup on
// purpose.
//
// (There used to be a second duty here — hourly garbage collection of expired
// tutor codes. It was removed: codes and their conversation data now live until
// a teacher deletes them explicitly, so their stats stay reachable.)
//
// Needs Node.js (database driver); the edge/browser builds of this file do
// nothing. The dynamic import keeps the database modules out of those bundles.
// The no-DB case (MSSQL_CONNECTION_STRING unset, e.g. plain `next build`) is
// skipped: the app boots for DB-less flows like tutor validation, matching the
// graceful degradation in app/mastra/index.ts.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.MSSQL_CONNECTION_STRING) {
    console.warn("instrumentation: MSSQL_CONNECTION_STRING not set — skipping migrations");
    return;
  }

  const { runMigrations } = await import("@/lib/db/migrate");
  await runMigrations();
}
