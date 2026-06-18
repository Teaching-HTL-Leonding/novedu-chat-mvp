"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resolveAppOrigin } from "@/lib/app-origin";
import { requireTeacherUserId } from "@/lib/student-mode";
import {
  createTutorCode,
  getTutorCode,
  updateTutorCode,
  validateTutorCodeRequest,
} from "@/lib/tutor-code-store";
import { deleteTutorCodeAndData, deleteTutorCodesAndData } from "@/lib/tutor-stats-store";
import { defaultFetcher, loadAndBuildTutorPrompt, type ValidationError } from "@/lib/tutors";

export type TutorCodeFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  // A tutor that fails validation carries the FULL structured error list (codes,
  // field paths, missing variables) so the form can show the same actionable
  // detail as the files / validate-tutor pages — not just the first message.
  | { status: "error"; errors: ValidationError[] }
  // Edit succeeded. (Create does not use this — it redirects to the new code's
  // edit page, which shows the shareable link.)
  | { status: "saved" };

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

  // Land on the new code's edit page — it shows the shareable chat URL (with a
  // copy button) and lets the teacher tweak the note/window straight away.
  revalidatePath("/tutor-codes");
  redirect(`/tutor-codes/edit/${stored.code}`);
}

export type DeleteTutorCodeResult = { ok: true } | { ok: false; message: string };

/**
 * Permanently deletes a tutor code AND all of its conversation data (threads,
 * messages, attribution). Teacher-only but NOT owner-only: any effective teacher
 * may delete any code (finer-grained RBAC is planned). Replaced the hourly
 * garbage collection: data now lives until deleted here. `deleteTutorCodeAndData`
 * is idempotent, so deleting an already-gone code is a no-op success.
 * Revalidates the Shared Tutor Codes list on success.
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

/** The uniform shape every list's "Delete Selected" action returns. */
export type DeleteSelectedResult = { ok: true; deleted: number } | { ok: false; message: string };

/**
 * Bulk version behind the tutor-code list's "Delete Selected" button. Teacher-only
 * (same gate, NOT owner-only — RBAC planned) and runs the SAME per-code logic as
 * the single delete via `deleteTutorCodesAndData`, so a multi-delete is identical,
 * code for code, to pressing each row's trash button. Idempotent; revalidates the
 * list on success.
 */
export async function deleteSelectedTutorCodesAction(
  codes: string[],
): Promise<DeleteSelectedResult> {
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

  const result = await deleteTutorCodesAndData(codes);
  if (!result.ok) {
    return {
      ok: false,
      message: "Some data could not be deleted. Try again — deletion is safe to repeat.",
    };
  }

  revalidatePath("/tutor-codes");
  return { ok: true, deleted: result.deleted };
}

/**
 * Saves edits to a tutor code's availability window and note. Teacher-only (any
 * effective teacher, RBAC planned). The tutor URL is NOT editable — it is read
 * from the stored row (frozen, along with the `anonymous` flag it implies), so no
 * YAML re-validation is needed; only the window + note are re-validated.
 * `code` is bound by the edit form; `useActionState` supplies `(prev, formData)`.
 */
export async function updateTutorCodeAction(
  code: string,
  _prev: TutorCodeFormState,
  formData: FormData,
): Promise<TutorCodeFormState> {
  const gate = await requireTeacherUserId();
  if (!gate.ok) {
    return {
      status: "error",
      message:
        gate.reason === "not-teacher"
          ? "Only teachers can edit tutor codes."
          : "Your session carries no user id — sign in again.",
    };
  }

  const entry = await getTutorCode(code);
  if (entry === undefined) {
    return {
      status: "error",
      message: "The tutor code could not be checked right now — try again.",
    };
  }
  if (entry === null) {
    return { status: "error", message: "This tutor code no longer exists. Reload the list." };
  }

  // Reuse the create-time validator with the STORED url (which is already
  // normalized, so it passes) — it also validates the window + note.
  const validation = validateTutorCodeRequest({
    tutor: entry.tutorUrl,
    start: formData.get("startTs"),
    end: formData.get("endTs"),
    note: formData.get("note"),
  });
  if (!validation.ok) return { status: "error", message: validation.message };

  const result = await updateTutorCode(code, {
    validFrom: validation.payload.validFrom,
    validUntil: validation.payload.validUntil,
    note: validation.payload.note,
  });
  if (!result.ok) {
    return {
      status: "error",
      message:
        result.reason === "not-found"
          ? "This tutor code no longer exists. Reload the list."
          : "The tutor code could not be saved. Try again.",
    };
  }

  revalidatePath("/tutor-codes");
  revalidatePath(`/tutor-codes/edit/${code}`);
  return { status: "saved" };
}
