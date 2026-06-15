"use server";

import { revalidatePath } from "next/cache";
import { resolveAppOrigin } from "@/lib/app-origin";
import { requireTeacherUserId } from "@/lib/student-mode";
import {
  createTutorCode,
  getOwnedTutorCode,
  validateTutorCodeRequest,
} from "@/lib/tutor-code-store";
import { deleteTutorCodeAndData } from "@/lib/tutor-stats-store";
import { defaultFetcher, loadAndBuildTutorPrompt, type ValidationError } from "@/lib/tutors";

export type TutorCodeFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  // A tutor that fails validation carries the FULL structured error list (codes,
  // field paths, missing variables) so the form can show the same actionable
  // detail as the files / validate-tutor pages — not just the first message.
  | { status: "error"; errors: ValidationError[] }
  // `link` is the full chat URL (`https://<origin>/<code>`), ready to hand out.
  | { status: "success"; link: string; note: string };

// Creates a Tutor Code for a tutor + availability window. The stored row is the
// only artifact — there is no stateless fallback, so a storage failure is a
// hard error. The browser submits `startTs`/`endTs` as unix seconds (computed
// client-side — only the browser knows the teacher's timezone); the raw
// datetime-local fields are display-only.
export async function createTutorCodeAction(
  _prev: TutorCodeFormState,
  formData: FormData,
): Promise<TutorCodeFormState> {
  // One gate yields both "is an effective teacher" and the user id, so no
  // second auth() round trip (each auth() call re-decrypts the session cookie).
  const gate = await requireTeacherUserId();
  if (!gate.ok) {
    return {
      status: "error",
      message:
        gate.reason === "not-teacher"
          ? "Only teachers can create tutor codes."
          : "Your session carries no user id — sign in again.",
    };
  }
  const userId = gate.userId;

  const validation = validateTutorCodeRequest({
    tutor: formData.get("tutor"),
    start: formData.get("startTs"),
    end: formData.get("endTs"),
    note: formData.get("note"),
  });
  if (!validation.ok) return { status: "error", message: validation.message };

  // Catch broken tutors at create time, not when the first student opens the
  // code. `validateLibraries` makes this the THOROUGH gate: every fragment in
  // every referenced library is rendered, even ones this tutor doesn't use — a
  // check too heavy for the chat hot path, but exactly right before sharing.
  const result = await loadAndBuildTutorPrompt(validation.payload.tutorUrl, defaultFetcher, {
    validateLibraries: true,
  });
  if (!result.ok) {
    return { status: "error", errors: result.errors };
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
  const gate = await requireTeacherUserId();
  if (!gate.ok) {
    return {
      ok: false,
      message:
        gate.reason === "not-teacher"
          ? "Only teachers can delete tutor codes."
          : "Your session carries no user id — sign in again.",
    };
  }
  const userId = gate.userId;

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
