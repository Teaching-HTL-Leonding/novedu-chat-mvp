"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { invalidateHome } from "@/lib/home-data";
import { deleteOwnQuizResults } from "@/lib/quiz-result-store";
import { getSession } from "@/lib/session";
import { updateUserSettings as storeSettings } from "@/lib/user-settings-store";

// The Settings page's writes (docs/home.md → Settings page). Every action acts
// ONLY on the session user's own row — the user id is never client-supplied —
// and needs no teacher gate. A successful write drops the user's cached start
// page on the server (`invalidateHome`) and in the browser's router cache
// (`revalidatePath("/")`), so Back never restores stale medals. No type
// re-exports here: a `"use server"` module may export async functions only.

export type SettingsActionResult = { ok: true } | { ok: false; message: string };

export type DeleteResultsActionResult =
  | { ok: true; deleted: number }
  | { ok: false; message: string };

// Every field is optional, but at least one must be present; an unknown field
// rejects the whole call (a forged or stale client, never silently ignored).
const SETTINGS_PATCH = z
  .strictObject({ saveQuizResults: z.boolean().optional() })
  .refine((patch) => Object.keys(patch).length > 0);

const NOT_SIGNED_IN = "Please sign in to continue.";

async function sessionUserId(): Promise<string | undefined> {
  const session = await getSession();
  return session?.user?.id ?? undefined;
}

/** Upserts the session user's settings. */
export async function updateUserSettings(patch: unknown): Promise<SettingsActionResult> {
  const parsed = SETTINGS_PATCH.safeParse(patch);
  if (!parsed.success) return { ok: false, message: "These settings are not valid." };
  const userId = await sessionUserId();
  if (!userId) return { ok: false, message: NOT_SIGNED_IN };
  if (!(await storeSettings(userId, parsed.data))) {
    return { ok: false, message: "Your settings could not be saved right now. Please try again." };
  }
  invalidateHome(userId);
  revalidatePath("/");
  return { ok: true };
}

/** Deletes every saved quiz result of the session user. Earned badges stay. */
export async function deleteMyQuizResults(): Promise<DeleteResultsActionResult> {
  const userId = await sessionUserId();
  if (!userId) return { ok: false, message: NOT_SIGNED_IN };
  const deleted = await deleteOwnQuizResults(userId);
  if (deleted === undefined) {
    return {
      ok: false,
      message: "Your saved results could not be deleted right now. Please try again.",
    };
  }
  invalidateHome(userId);
  revalidatePath("/");
  return { ok: true, deleted };
}
