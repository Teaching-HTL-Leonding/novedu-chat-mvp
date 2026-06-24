"use server";

import { auth } from "@/auth";
import { type CodeRejection, checkCode } from "@/lib/code-store";
import { loadWriting } from "@/lib/writing-fetch";
import { saveSubmission } from "@/lib/writing-store";

// The student-facing writing server action. The whole app sits behind the Entra
// gate, so any caller is authenticated; the writing CODE (a `novedu_codes` row
// with `module: "writing"`) is what authorizes the activity, and it is
// RE-VERIFIED on every save (so a code outside its window stops accepting saves
// mid-session). A student may write ONLY their own `(code, user_id)` row — the
// row key is the session `oid`, never client-supplied.
//
// Writing DEFAULTS `anonymous: false` (the writing divergence): saving needs
// attribution. As defense in depth this action re-reads the privacy flag LIVE
// from the YAML and REJECTS the save when the activity is anonymous, so an
// anonymous writing code never accumulates attributed rows even if the client
// tries.

export interface SaveWritingInput {
  code: string;
  text: string;
}

export type SaveWritingResult = { ok: true } | { ok: false; message: string };

const CODE_REJECTION_MESSAGES: Record<CodeRejection, string> = {
  "unknown-code": "This writing code is not valid.",
  "not-started": "This writing activity's availability window has not started yet.",
  expired: "This writing activity's availability window has ended.",
  "lookup-failed": "Writing codes cannot be checked right now — try again in a moment.",
};

/**
 * Saves a student's writing text for a code. Re-verifies the code is valid and in
 * its window, resolves the authenticated session `oid` as the row owner, re-reads
 * the activity's `anonymous` flag LIVE (rejecting an anonymous activity), then
 * upserts the student's single row. Nothing is graded or echoed back.
 */
export async function saveWriting(input: SaveWritingInput): Promise<SaveWritingResult> {
  const text = typeof input.text === "string" ? input.text.trim() : "";

  const verification = await checkCode(input.code);
  if (!verification.ok) {
    return { ok: false, message: CODE_REJECTION_MESSAGES[verification.reason] };
  }
  const { entry } = verification;
  if (entry.module !== "writing") {
    return { ok: false, message: "This code is not a writing activity." };
  }

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, message: "Please sign in to continue." };

  // Re-read the privacy flag LIVE from the YAML (defense in depth): an anonymous
  // writing activity never stores attributed text, so saving is disabled for it.
  const loaded = await loadWriting(entry.fileUrl);
  if (!loaded.ok) return { ok: false, message: loaded.message };
  if (loaded.writing.anonymous) {
    return { ok: false, message: "This writing activity does not save your text." };
  }

  try {
    await saveSubmission({ code: entry.code, userId, text });
    return { ok: true };
  } catch (error) {
    console.error("writing-actions: saving a submission failed", error);
    return { ok: false, message: "Your text could not be saved right now. Please try again." };
  }
}
