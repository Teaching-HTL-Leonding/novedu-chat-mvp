import { demoBootRefusal } from "@/lib/demo-env-lock";

// The demo build's startup duties (docs/auth.md, "Demo mode"), called from
// instrumentation.ts ONLY inside its `process.env.NOVEDU_AUTH_MODE === "demo"`
// branches and only through `await import()`, so an Entra build carries none of it.

/**
 * Logged once at a demo build's boot. Also a build marker
 * (scripts/ci/check-demo-markers.mjs): its literal in compiled output identifies a
 * demo build.
 */
export const DEMO_BOOT_LOG_LINE =
  "instrumentation: auth mode DEMO — one-click demo accounts, no Entra";

/**
 * The env lock — before any database work, also when DATABASE_URL is unset —
 * then the log line naming the mode. Throws on a refusal, aborting startup.
 */
export function startDemoBoot(env: Record<string, string | undefined>): void {
  const refusal = demoBootRefusal(env);
  if (refusal) throw new Error(refusal);
  console.log(DEMO_BOOT_LOG_LINE);
}
