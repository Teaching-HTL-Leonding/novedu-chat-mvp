"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireEffectiveTeacher } from "@/lib/student-mode";
import {
  createTutorCode,
  getOwnedTutorCode,
  validateTutorCodeRequest,
} from "@/lib/tutor-code-store";
import { deleteTutorCodeAndData } from "@/lib/tutor-stats-store";
import { defaultFetcher, loadAndBuildTutorPrompt } from "@/lib/tutors";

export type TutorCodeFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  // `link` is the full chat URL (`https://<origin>/<code>`), ready to hand out.
  | { status: "success"; link: string; note: string };

// The origin the generated chat URLs point at. Prefer the explicit
// TUTOR_CODE_ORIGIN env var (set it in production — forwarded headers are only
// as trustworthy as the proxy chain in front of the app). Without it, fall back
// to the request's forwarded/host headers, which is fine for local dev.
// Multi-hop proxies append comma-separated values, so only the first
// (client-most) entry counts. Display-only: a code works on ANY origin.
async function resolveAppOrigin(): Promise<string> {
  const configured = process.env.TUTOR_CODE_ORIGIN;
  if (configured) return new URL(configured).origin;

  const h = await headers();
  const first = (value: string | null) => value?.split(",")[0]?.trim() || undefined;
  const host = first(h.get("x-forwarded-host")) ?? first(h.get("host"));
  if (!host) throw new Error("No host header");
  const proto = first(h.get("x-forwarded-proto")) ?? "http";
  return new URL(`${proto}://${host}`).origin;
}

// Creates a Tutor Code for a tutor + availability window. The stored row is the
// only artifact — there is no stateless fallback, so a storage failure is a
// hard error. The browser submits `startTs`/`endTs` as unix seconds (computed
// client-side — only the browser knows the teacher's timezone); the raw
// datetime-local fields are display-only.
export async function createTutorCodeAction(
  _prev: TutorCodeFormState,
  formData: FormData,
): Promise<TutorCodeFormState> {
  // The guard returns the session, so the user id below needs no second
  // auth() round trip (each auth() call re-decrypts the session cookie).
  let session: Awaited<ReturnType<typeof requireEffectiveTeacher>>;
  try {
    session = await requireEffectiveTeacher();
  } catch {
    return { status: "error", message: "Only teachers can create tutor codes." };
  }

  const validation = validateTutorCodeRequest({
    tutor: formData.get("tutor"),
    start: formData.get("startTs"),
    end: formData.get("endTs"),
    note: formData.get("note"),
  });
  if (!validation.ok) return { status: "error", message: validation.message };

  // Catch broken tutors at create time, not when the first student opens the
  // code. Reuses the same pipeline the chat page runs on the receiving end.
  const result = await loadAndBuildTutorPrompt(validation.payload.tutorUrl, defaultFetcher);
  if (!result.ok) {
    const first = result.errors[0];
    return {
      status: "error",
      message: first
        ? `The tutor failed validation (${first.code}): ${first.message}`
        : "The tutor failed validation.",
    };
  }

  let origin: string;
  try {
    origin = await resolveAppOrigin();
  } catch {
    return {
      status: "error",
      message:
        "Could not determine the app's public address. Set TUTOR_CODE_ORIGIN in the server configuration.",
    };
  }

  const userId = session.user?.id;
  if (!userId) {
    return { status: "error", message: "Your session carries no user id — sign in again." };
  }
  // Freeze the tutor's anonymity flag onto the row at create time. `result`
  // is the just-validated YAML; a later edit to it will not change the stored
  // value (documented behavior). `loadAndBuildTutorPrompt` defaults it to true.
  const stored = await createTutorCode(userId, {
    ...validation.payload,
    origin,
    anonymous: result.anonymous,
  });
  if (!stored.stored) {
    return {
      status: "error",
      message: "The tutor code could not be stored. Try again, or contact the operator.",
    };
  }

  return {
    status: "success",
    link: `${origin}/${stored.code}`,
    note: validation.payload.note,
  };
}

export type DeleteTutorCodeResult = { ok: true } | { ok: false; message: string };

/**
 * Permanently deletes a tutor code AND all of its conversation data (threads,
 * messages, attribution). Teacher-only and owner-only: a teacher may delete only
 * codes they created — the ownership check (`getOwnedTutorCode`) doubles as the
 * "does it still exist" check. Replaced the hourly garbage collection: data now
 * lives until deleted here. Revalidates the Shared Tutor Codes list on success.
 */
export async function deleteTutorCodeAction(code: string): Promise<DeleteTutorCodeResult> {
  let session: Awaited<ReturnType<typeof requireEffectiveTeacher>>;
  try {
    session = await requireEffectiveTeacher();
  } catch {
    return { ok: false, message: "Only teachers can delete tutor codes." };
  }
  const userId = session.user?.id;
  if (!userId) {
    return { ok: false, message: "Your session carries no user id — sign in again." };
  }

  const owned = await getOwnedTutorCode(code, userId);
  if (owned === undefined) {
    return { ok: false, message: "The tutor code could not be checked right now — try again." };
  }
  if (owned === null) {
    // Already gone, or never the caller's to delete. Either way there is
    // nothing for this teacher to act on; treat as done so the row clears.
    revalidatePath("/tutor-codes");
    return { ok: true };
  }

  const deleted = await deleteTutorCodeAndData(code);
  if (!deleted) {
    return {
      ok: false,
      message: "Some data could not be deleted. Try again — deletion is safe to repeat.",
    };
  }

  revalidatePath("/tutor-codes");
  return { ok: true };
}
