import { gcOrphanedRecentCodes } from "@/lib/recent-code-store";
import { gcExpiredTutorCodes } from "@/lib/tutor-code-store";

// Hourly garbage collection of expired tutor codes (plus recent-code shortcuts
// orphaned by that), started once per server from instrumentation.ts. An
// in-process timer is enough for the single-container deployment; if the app
// ever scales out, every instance runs it and the DELETEs are idempotent —
// wasteful, not harmful.
//
// `novedu_user_chats` is deliberately NOT collected: the user↔chat mapping
// outlives the code so chat-history attribution keeps working.

const GC_INTERVAL_MS = 60 * 60 * 1000;

// Survives dev-mode module reloads (HMR re-evaluates this module, but
// globalThis persists), so at most one timer ever runs per process.
const globalForGc = globalThis as unknown as {
  tutorCodeGc?: { running: boolean };
};

async function run(state: { running: boolean }): Promise<void> {
  // Overlap guard: if a run is still going when the next tick fires (e.g. the
  // database hangs), skip — the following tick catches up.
  if (state.running) return;
  state.running = true;
  try {
    await gcExpiredTutorCodes();
    await gcOrphanedRecentCodes();
  } catch (error) {
    // gcExpiredTutorCodes never throws; belt and braces — GC must never take
    // the server down.
    console.error("tutor-code-gc: unexpected failure", error);
  } finally {
    state.running = false;
  }
}

export function startTutorCodeGc(): void {
  if (globalForGc.tutorCodeGc) return;
  const state = { running: false };
  globalForGc.tutorCodeGc = state;

  // First sweep right away (the server may have been down past many expiries),
  // then hourly. `unref()` keeps the timer from blocking a clean shutdown.
  void run(state);
  setInterval(() => void run(state), GC_INTERVAL_MS).unref();
}
