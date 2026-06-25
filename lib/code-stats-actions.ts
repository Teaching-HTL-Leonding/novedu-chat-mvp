"use server";

import type { Message } from "@ag-ui/core";
import { getConversationMessages } from "@/lib/code-stats-store";
import { requireEffectiveTeacher } from "@/lib/student-mode";

// Server actions over a code's conversation data, for client components that load
// transcripts on demand (the writing student page's conversation lightbox).
//
// Kept SEPARATE from lib/code-stats-store.ts on purpose: a "use server" directive
// marks every export of its module as a server action, but that store exports
// plain server functions called directly by server components — the two cannot
// share a file.

/**
 * The messages of one conversation under a code, for lazy display in the teacher's
 * conversation lightbox. Teacher-only (`requireEffectiveTeacher` — honours student
 * mode, so a teacher viewing as a student is refused); `getConversationMessages`
 * additionally re-checks the thread belongs to the code. Returns `undefined` on a
 * database error, `[]` for an unknown/empty thread.
 */
export async function loadConversationTranscript(
  code: string,
  threadId: string,
): Promise<Message[] | undefined> {
  await requireEffectiveTeacher();
  return getConversationMessages(code, threadId);
}
