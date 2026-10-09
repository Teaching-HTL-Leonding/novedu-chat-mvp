// The tutor chat's per-TAB memory of its current conversation, so an accidental
// reload resumes it instead of starting over (docs/chat.md → Resuming a
// conversation). Client-safe; no server imports.
//
// `sessionStorage`, deliberately: it survives a reload of the same tab and is
// gone when the tab or the browser closes, so two tabs are two conversations.
// Never `localStorage`, never the URL (no signed links — docs/codes.md). What is
// stored — the thread id and its ownership token — grants nothing the tab did
// not already hold (lib/thread-token.ts), and the server still decides whether
// the thread may be resumed (`resumeTutorThread`, lib/tutor-actions.ts).
//
// Every access is wrapped: a missing or throwing `sessionStorage` (private mode,
// blocked site data) simply turns the feature off, and a malformed value is
// treated as absent and removed.

const KEY_PREFIX = "novedu.tutorThread.";

export interface StoredTutorThread {
  threadId: string;
  threadToken: string;
}

function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

function keyFor(code: string): string {
  return `${KEY_PREFIX}${code}`;
}

/** The thread this tab last used for `code`, or `null` when none (or unreadable). */
export function readTutorThread(code: string): StoredTutorThread | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(keyFor(code));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as StoredTutorThread).threadId === "string" &&
      typeof (parsed as StoredTutorThread).threadToken === "string"
    ) {
      const { threadId, threadToken } = parsed as StoredTutorThread;
      return { threadId, threadToken };
    }
  } catch {
    // Unparseable — fall through and drop it.
  }
  removeTutorThread(code);
  return null;
}

/** Remembers `value` as this tab's current thread for `code`. */
export function writeTutorThread(code: string, value: StoredTutorThread): void {
  try {
    storage()?.setItem(
      keyFor(code),
      JSON.stringify({ threadId: value.threadId, threadToken: value.threadToken }),
    );
  } catch {
    // Quota or blocked storage: the feature is simply off.
  }
}

/** Forgets this tab's thread for `code`. */
export function removeTutorThread(code: string): void {
  try {
    storage()?.removeItem(keyFor(code));
  } catch {
    // Nothing to do.
  }
}

/**
 * Forgets every tutor thread this tab remembers (sign-out: the next person on
 * this tab must not inherit them). Touches only this module's own keys.
 */
export function clearAllTutorThreads(): void {
  const store = storage();
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // Nothing to do.
  }
}
