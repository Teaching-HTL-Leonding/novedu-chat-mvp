import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { usageByCode, usageByUser } from "@/lib/db/schema";
import { recordError } from "@/lib/telemetry";

// The write seam for usage metering — the ONLY access to `novedu_usage_by_code`
// and `novedu_usage_by_user`. Mirrors lib/user-chat-store.ts discipline: it NEVER
// throws (errors are logged + routed to `recordError` and dropped), so a lost
// increment can never break a chat, a grade, a save, or the coding proxy. Every
// write is an increment-UPSERT into a tiny hourly bucket, called OFF the response
// path (the observability exporter is async; the route/action counters run in
// `after()` / fire-and-forget).
//
// Anonymity: `usage_by_code` carries no user and `usage_by_user` carries no code —
// neither table ever links a student to an activity (docs/codes.md,
// docs/usage-metering.md). A caller with a `userId` meters BOTH tables (even for an
// anonymous code — the oid is only ever stored against an hour bucket); a caller
// without one (the coding proxy) meters `usage_by_code` alone.
//
// SERVER-ONLY: uses the database. Never import from client components.

/** The seven metric deltas; any omitted field defaults to 0 (a no-op increment). */
interface UsageDeltas {
  inputTokensNew?: number;
  inputTokensCached?: number;
  outputTokens?: number;
  toolCalls?: number;
  userMessages?: number;
  quizAnswers?: number;
  writingSaves?: number;
}

// Mirrors isDuplicateKeyError in the other stores: mssql 2627/2601 in the error's
// `cause` chain means the `(code|user, hour)` row already exists, so the UPSERT
// falls back to an increment UPDATE.
function isDuplicateKeyError(error: unknown): boolean {
  for (let e = error; typeof e === "object" && e !== null; e = (e as { cause?: unknown }).cause) {
    const number = (e as { number?: unknown }).number;
    if (number === 2627 || number === 2601) return true;
  }
  return false;
}

/**
 * Truncates a Date to the top of its UTC hour — the bucket key for both tables.
 * Exported for unit testing.
 */
export function hourBucket(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), 0, 0, 0),
  );
}

// Increment-UPSERT: INSERT the bucket with the deltas as its initial values; on a
// duplicate key (the bucket exists, or a concurrent writer just created it)
// increment each column in place. Same INSERT-first / catch-UPDATE idiom as
// writing-store, adapted to ADD rather than overwrite — so two concurrent writers
// on one bucket both land (one inserts, the other catches + increments). An
// UPDATE-first form would avoid the per-hit exception once the bucket exists, but
// the proven idiom is preferred here; contention on one hourly bucket is negligible
// at classroom scale.
async function bumpByCode(code: string, hour: Date, module: string, d: UsageDeltas): Promise<void> {
  const db = getDb();
  try {
    await db.insert(usageByCode).values({
      code,
      hour,
      module,
      inputTokensNew: d.inputTokensNew ?? 0,
      inputTokensCached: d.inputTokensCached ?? 0,
      outputTokens: d.outputTokens ?? 0,
      toolCalls: d.toolCalls ?? 0,
      userMessages: d.userMessages ?? 0,
      quizAnswers: d.quizAnswers ?? 0,
      writingSaves: d.writingSaves ?? 0,
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    await db
      .update(usageByCode)
      .set({
        inputTokensNew: sql`${usageByCode.inputTokensNew} + ${d.inputTokensNew ?? 0}`,
        inputTokensCached: sql`${usageByCode.inputTokensCached} + ${d.inputTokensCached ?? 0}`,
        outputTokens: sql`${usageByCode.outputTokens} + ${d.outputTokens ?? 0}`,
        toolCalls: sql`${usageByCode.toolCalls} + ${d.toolCalls ?? 0}`,
        userMessages: sql`${usageByCode.userMessages} + ${d.userMessages ?? 0}`,
        quizAnswers: sql`${usageByCode.quizAnswers} + ${d.quizAnswers ?? 0}`,
        writingSaves: sql`${usageByCode.writingSaves} + ${d.writingSaves ?? 0}`,
      })
      .where(and(eq(usageByCode.code, code), eq(usageByCode.hour, hour)));
  }
}

async function bumpByUser(userId: string, hour: Date, d: UsageDeltas): Promise<void> {
  const db = getDb();
  try {
    await db.insert(usageByUser).values({
      userId,
      hour,
      inputTokensNew: d.inputTokensNew ?? 0,
      inputTokensCached: d.inputTokensCached ?? 0,
      outputTokens: d.outputTokens ?? 0,
      toolCalls: d.toolCalls ?? 0,
      userMessages: d.userMessages ?? 0,
      quizAnswers: d.quizAnswers ?? 0,
      writingSaves: d.writingSaves ?? 0,
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    await db
      .update(usageByUser)
      .set({
        inputTokensNew: sql`${usageByUser.inputTokensNew} + ${d.inputTokensNew ?? 0}`,
        inputTokensCached: sql`${usageByUser.inputTokensCached} + ${d.inputTokensCached ?? 0}`,
        outputTokens: sql`${usageByUser.outputTokens} + ${d.outputTokens ?? 0}`,
        toolCalls: sql`${usageByUser.toolCalls} + ${d.toolCalls ?? 0}`,
        userMessages: sql`${usageByUser.userMessages} + ${d.userMessages ?? 0}`,
        quizAnswers: sql`${usageByUser.quizAnswers} + ${d.quizAnswers ?? 0}`,
        writingSaves: sql`${usageByUser.writingSaves} + ${d.writingSaves ?? 0}`,
      })
      .where(and(eq(usageByUser.userId, userId), eq(usageByUser.hour, hour)));
  }
}

// Applies deltas to `usage_by_code` (always) and `usage_by_user` (only when a
// userId is present). The single fan-out point, guarded so a metering write never
// throws into a caller.
async function record(
  code: string,
  module: string,
  userId: string | undefined,
  at: Date,
  d: UsageDeltas,
  op: string,
): Promise<void> {
  try {
    const hour = hourBucket(at);
    await bumpByCode(code, hour, module, d);
    if (userId) await bumpByUser(userId, hour, d);
  } catch (error) {
    console.error(`usage-store: ${op} failed`, error);
    recordError(error, { store: "usage", op });
  }
}

/** LLM token usage for one generation, from the observability exporter or the coding proxy. */
export interface LlmUsageInput {
  code: string;
  module: string;
  /** Absent ⇒ only `usage_by_code` is metered (the coding-proxy path carries no oid). */
  userId?: string;
  inputNew: number;
  inputCached: number;
  output: number;
  toolCalls: number;
  /** The event time (e.g. the span end); defaults to now. Selects the hour bucket. */
  at?: Date;
}

/** Records token counts (+ tool calls) for one generation. Never throws. */
export function recordLlmUsage(input: LlmUsageInput): Promise<void> {
  return record(
    input.code,
    input.module,
    input.userId,
    input.at ?? new Date(),
    {
      inputTokensNew: input.inputNew,
      inputTokensCached: input.inputCached,
      outputTokens: input.output,
      toolCalls: input.toolCalls,
    },
    "recordLlmUsage",
  );
}

/** +1 user message for a code and its student. Never throws. */
export function recordUserMessage(input: {
  code: string;
  module: string;
  userId: string;
}): Promise<void> {
  return record(
    input.code,
    input.module,
    input.userId,
    new Date(),
    { userMessages: 1 },
    "recordUserMessage",
  );
}

/** +1 quiz answer for a quiz code and its student. Never throws. */
export function recordQuizAnswer(input: { code: string; userId: string }): Promise<void> {
  return record(
    input.code,
    "quiz",
    input.userId,
    new Date(),
    { quizAnswers: 1 },
    "recordQuizAnswer",
  );
}

/** +1 writing save for a writing code and its student. Never throws. */
export function recordWritingSave(input: { code: string; userId: string }): Promise<void> {
  return record(
    input.code,
    "writing",
    input.userId,
    new Date(),
    { writingSaves: 1 },
    "recordWritingSave",
  );
}
