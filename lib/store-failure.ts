import { sqlState } from "@/lib/db/errors";
import { recordError } from "@/lib/telemetry";

// Failure reporting for stores whose statements carry user ids and personal
// counts as parameters. A Drizzle error's message embeds the SQL text AND its
// parameter values, so the raw error never reaches the log or telemetry: only a
// fixed message plus the SQLSTATE (docs/home.md → Error handling).
//
// SERVER-ONLY. Never import from client components.

export function reportStoreFailure(store: string, op: string, error: unknown): void {
  const failure = new Error(`${store}: ${op} failed`);
  const state = sqlState(error) ?? "none";
  console.error(failure.message, { sqlState: state });
  recordError(failure, { store, op, sqlState: state });
}
