import { getDb } from "@/lib/db";
import { userChats } from "@/lib/db/schema";
import { defaultFetcher, loadAndBuildTutorPrompt } from "@/lib/tutors";

// Records which signed-in user owns which chat (Mastra thread) in
// `novedu_user_chats` — the ONLY place tying users to chats. Attribution is
// opt-in per tutor: by default (`anonymous: true`, the YAML's default) NOTHING
// is written here; only a tutor with `anonymous: false` records the link.
//
// Called from the chat runtime route off the response path (next/server's
// `after()`) on every run request, so this module must never throw and must
// stay cheap for repeat calls: a small in-process dedupe cache remembers
// threads that were already handled (stored OR decided against), and only a
// cache miss pays the tutor-YAML fetch + insert.
//
// SERVER-ONLY: uses the database. Never import from client components.

// Thread ids are server-generated UUIDs (app/[code]/page.tsx) and the runtime
// route only forwards token-verified ones — this pattern is defense in depth
// against anything else slipping through.
const THREAD_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

// Insertion-ordered Map as a bounded dedupe cache (~one entry per chat opened
// since the server started). `true` = row written, `false` = decided not to
// write (anonymous tutor) — both skip all further work. Only DEFINITIVE
// outcomes are cached: a failed YAML load or DB insert stays uncached so the
// next run request retries.
const DEDUPE_CACHE_LIMIT = 1000;
const dedupeCache = new Map<string, boolean>();

function rememberDecision(key: string, stored: boolean): void {
  if (dedupeCache.size >= DEDUPE_CACHE_LIMIT) {
    const oldest = dedupeCache.keys().next().value;
    if (oldest !== undefined) dedupeCache.delete(oldest);
  }
  dedupeCache.set(key, stored);
}

/** Clears the dedupe cache — for unit tests only. */
export function resetUserChatDedupeCacheForTests(): void {
  dedupeCache.clear();
}

// Mirrors isDuplicateKeyError in tutor-code-store: mssql 2627/2601 wrapped in a
// DrizzleQueryError's `cause` chain. A duplicate here just means the row exists
// (e.g. after a server restart emptied the cache) — success, not an error.
function isDuplicateKeyError(error: unknown): boolean {
  for (let e = error; typeof e === "object" && e !== null; e = (e as { cause?: unknown }).cause) {
    const number = (e as { number?: unknown }).number;
    if (number === 2627 || number === 2601) return true;
  }
  return false;
}

/**
 * Persists the user↔chat link for a thread opened under a tutor code — IF the
 * tutor opts into attribution (`anonymous: false` in its YAML). The flag is
 * read server-side from the YAML behind the stored tutor URL, never from
 * anything the client sent. When the YAML cannot be loaded, the privacy-safe
 * default applies: nothing is stored. Never throws.
 */
export async function recordUserChat(
  code: string,
  threadId: string,
  userId: string,
  tutorUrl: string,
): Promise<void> {
  if (!THREAD_ID_PATTERN.test(threadId)) {
    console.error("user-chat-store: rejecting malformed thread id, chat not recorded");
    return;
  }
  const key = `${code}/${threadId}`;
  if (dedupeCache.has(key)) return;

  // One YAML fetch per new thread (not per request — the dedupe cache catches
  // the rest). Failure falls through to "anonymous": better to lose
  // attribution than to attribute against a tutor we could not read. But a
  // failure is NOT cached — a transient fetch error on a thread's first
  // message must not silence attribution for the thread's whole lifetime, so
  // only a definitive read of the YAML's `anonymous` flag remembers the
  // decision (mirroring the DB-failure path below).
  let anonymous = true;
  let definitive = false;
  try {
    const tutor = await loadAndBuildTutorPrompt(tutorUrl, defaultFetcher);
    if (tutor.ok) {
      anonymous = tutor.anonymous;
      definitive = true;
    }
  } catch (error) {
    console.error("user-chat-store: loading the tutor YAML failed, chat stays anonymous", error);
  }
  if (anonymous) {
    if (definitive) rememberDecision(key, false);
    return;
  }

  try {
    await getDb().insert(userChats).values({ threadId, code, userId, createdAt: new Date() });
    rememberDecision(key, true);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      rememberDecision(key, true); // row already exists — same outcome as storing
      return;
    }
    // NOT cached: a transient DB error should retry on the next run request.
    console.error("user-chat-store: failed to record user chat", error);
  }
}
