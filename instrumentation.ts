import type { Instrumentation } from "next";

// Runs ONCE per server instance, before the first request is served (Next.js
// instrumentation file convention). Startup duties, in order:
//
//   1. Bring up telemetry FIRST (Azure Monitor or standard OTLP export — the
//      facade picks one from the environment, docs/telemetry.md), so its
//      auto-instrumentation can patch the HTTP and `pg` modules before anything
//      opens a connection. No-op when no destination is configured. Also
//      records a content-free `app_started` event.
//   2. Warn ONCE when the quiz pre-check is half-configured
//      (`QUIZ_IMMEDIATE_FEEDBACK=true` without `OPENROUTER_API_KEY`): the gate
//      then behaves as off, so without this line an operator who enabled the
//      feature would see nothing happen and nothing said (docs/codes.md,
//      "Immediate feedback").
//   3. Log the image storage root's state (`verifyImageRoot`, `lib/image-fs.ts`)
//      — independent of the database, so it runs even when DATABASE_URL is
//      unset below. A missing/misconfigured root only warns: the app keeps
//      booting and every image operation reports `unavailable` until an
//      operator fixes it (`npm run images:init-root`).
//   4. Apply pending Drizzle migrations to the app-owned `novedu_*` tables — the
//      server must never run against an older schema than its code expects.
//      Failures abort startup on purpose.
//   5. Create the `mastra` schema and Mastra's `mastra_*` tables inside it
//      (`initMastraStorage`). Mastra would create the tables itself, but only on
//      the store's first use — and `lib/code-stats-store.ts` reads those tables
//      directly, so on a database where no agent has run yet the teacher's stats
//      panels would break first. Same fail-loud policy as (4). The schema
//      statement sits inside that function, beside the `init()` it guards, rather
//      than here — see app/mastra/index.ts.
//
// Expired codes are NOT garbage-collected: codes and their conversation data live
// until a teacher deletes them explicitly, so their stats stay reachable.
//
// Needs Node.js (database driver + OTEL SDK); the edge/browser builds of this
// file do nothing. The dynamic imports keep those modules out of edge bundles.
// The no-DB case (DATABASE_URL unset, e.g. plain `next build`) skips
// migrations: the app boots for DB-less flows like tutor validation, matching
// the graceful degradation in app/mastra/index.ts. Telemetry is independent of
// the DB and gated on its own destination settings.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { initTelemetry, emitEvent } = await import("@/lib/telemetry");
  await initTelemetry();
  emitEvent("app_started", { runtime: "nodejs" });

  const { immediateFeedbackMisconfigured } = await import("@/lib/quiz-immediate-feedback");
  if (immediateFeedbackMisconfigured()) {
    console.warn(
      "instrumentation: QUIZ_IMMEDIATE_FEEDBACK is set but OPENROUTER_API_KEY is missing — immediate feedback disabled",
    );
  }

  try {
    const { verifyImageRoot } = await import("@/lib/image-fs");
    const root = await verifyImageRoot();
    if (root.ok) {
      console.log(`instrumentation: image storage root OK — ${root.root}`);
    } else {
      console.warn(`instrumentation: image storage root unavailable — ${root.detail}`);
    }
  } catch (error) {
    console.warn("instrumentation: image storage root check failed", error);
  }

  if (!process.env.DATABASE_URL) {
    console.warn("instrumentation: DATABASE_URL not set — skipping migrations");
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
