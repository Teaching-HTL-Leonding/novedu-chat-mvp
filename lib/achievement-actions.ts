"use server";

import { markSeen } from "@/lib/achievement-store";
import { invalidateHome } from "@/lib/home-data";
import { getSession } from "@/lib/session";

// The start page's one write: once the new-badges strip has rendered, the
// client marks the shown badges as seen (docs/home.md → Evaluation flow). The
// row key is always the session user id, never client-supplied; foreign or
// unknown ids match no row. Idempotent.

/** More ids than the catalog holds can only be a forged call. */
const MAX_IDS = 64;
const MAX_ID_LENGTH = 64;

function isIdList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_IDS &&
    value.every((id) => typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LENGTH)
  );
}

/** Marks the session user's given badges as seen. Never throws to the client. */
export async function markAchievementsSeen(ids: unknown): Promise<{ ok: boolean }> {
  if (!isIdList(ids)) return { ok: false };
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return { ok: false };
  if (ids.length === 0) return { ok: true };
  const ok = await markSeen(userId, ids);
  invalidateHome(userId);
  return { ok };
}
