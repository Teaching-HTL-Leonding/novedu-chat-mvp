"use server";

import { revalidatePath } from "next/cache";
import { getCode } from "@/lib/code-store";
import { getOrCreateCodingKey } from "@/lib/coding-key-store";
import { requireTeacherUserId } from "@/lib/student-mode";

// The server action behind the "Get my API key" button on the coding module's
// teacher detail page. Minting is EXPLICIT on that surface: reading the page only
// calls `getStoredCodingKey`, so a teacher who merely looks at a coding code never
// lands in its issued-keys list (docs/coding.md). A student's `/<code>` visit still
// mints implicitly — that visit IS the request for a key, and it carries its own
// attribution notice (app/[code]/render-coding.tsx).
//
// Kept SEPARATE from lib/coding-key-store.ts: a "use server" directive turns every
// export of its module into a server action, and the store's exports are plain
// server functions the public coding proxy calls directly — the two cannot share a
// file (same split as code-stats-actions.ts beside code-stats-store.ts).

/** What the button gets back — the key VALUE never travels here. */
export type MintCodingKeyResult = { ok: true } | { ok: false; message: string };

/**
 * Mints (or re-reads) the caller's own personal key for a coding code, then
 * revalidates the detail page so the re-render shows the connection block.
 *
 * GATE: `requireTeacherUserId()` — an EFFECTIVE teacher (student mode is refused)
 * plus the session `oid`, which is also the attribution the key row stores. One
 * gate yields both, so there is no second `auth()` round trip.
 *
 * VALIDATION: `getCode` must find a real `novedu_codes` row whose module is
 * `coding` — an unknown, deleted, or non-coding code is rejected WITHOUT touching
 * the key table, so the action can never mint a row for a code that does not
 * exist. Deliberately NOT `checkCode`: the availability window gates USE of a key,
 * which the proxy re-verifies on every request, not whether a teacher may prepare
 * one for a code that has not opened yet (or has already closed).
 *
 * The minted key is intentionally NOT returned: the page re-reads it server-side
 * on the revalidated render, so the secret has exactly one delivery path. Never
 * logs the key. Never throws.
 */
export async function mintCodingKeyAction(code: string): Promise<MintCodingKeyResult> {
  const gate = await requireTeacherUserId();
  if (!gate.ok) {
    return {
      ok: false,
      message:
        gate.reason === "not-teacher"
          ? "Only teachers can request a key here."
          : "Your session carries no user id — sign in again.",
    };
  }

  const entry = await getCode(code);
  if (entry === undefined) {
    return { ok: false, message: "The code could not be checked right now — try again." };
  }
  if (entry === null || entry.module !== "coding") {
    return { ok: false, message: "This coding activity no longer exists. Reload the page." };
  }

  const key = await getOrCreateCodingKey(code, gate.userId);
  if (!key) {
    return { ok: false, message: "Your key could not be created right now — try again." };
  }

  revalidatePath(`/codes/${code}`);
  return { ok: true };
}
