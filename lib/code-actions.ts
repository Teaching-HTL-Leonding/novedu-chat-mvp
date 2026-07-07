"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createCodeForUser } from "@/lib/code-service";
import { deleteCodesAndData } from "@/lib/code-stats-store";
import { getCode, updateCode, validateCodeRequest } from "@/lib/code-store";
import { providerUnavailableReason } from "@/lib/llm/availability";
import { requireTeacherUserId } from "@/lib/student-mode";
import type { ValidationError } from "@/lib/tutors";

export type CodeFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  // An activity that fails validation carries the FULL structured error list
  // (codes, field paths, missing variables) so the form can show the same
  // actionable detail as the files pages — not just the first message.
  | { status: "error"; errors: ValidationError[] }
  // Edit succeeded. (Create does not use this — it redirects to the new code's
  // edit page, which shows the shareable link.)
  | { status: "saved" };

// Creates a code for an activity (`module`) + file + availability window. Thin
// auth + FormData shell around the shared pipeline in `lib/code-service.ts`
// (the bearer API route is the other caller). The browser submits
// `startTs`/`endTs` as unix seconds (computed client-side — only the browser
// knows the teacher's timezone); the raw datetime-local fields are display-only.
export async function createCodeAction(
  _prev: CodeFormState,
  formData: FormData,
): Promise<CodeFormState> {
  // One gate yields both "is an effective teacher" and the user id, so no
  // second auth() round trip (each auth() call re-decrypts the session cookie).
  const gate = await requireTeacherUserId();
  if (!gate.ok) {
    return {
      status: "error",
      message:
        gate.reason === "not-teacher"
          ? "Only teachers can create codes."
          : "Your session carries no user id — sign in again.",
    };
  }

  const result = await createCodeForUser(gate.userId, {
    module: formData.get("module"),
    file: formData.get("file"),
    start: formData.get("startTs"),
    end: formData.get("endTs"),
    note: formData.get("note"),
    llmProvider: formData.get("llmProvider"),
    llmModel: formData.get("llmModel"),
  });
  if (!result.ok) {
    return result.reason === "validation"
      ? { status: "error", errors: result.errors }
      : { status: "error", message: result.message };
  }

  // Land on the new code's edit page — it shows the shareable URL (with a copy
  // button) and lets the teacher tweak the note/window straight away.
  revalidatePath("/codes");
  redirect(`/codes/edit/${result.entry.code}`);
}

/** The uniform shape every list's "Delete Selected" action returns. */
export type DeleteSelectedResult = { ok: true; deleted: number } | { ok: false; message: string };

/**
 * Bulk delete behind the codes list's "Delete Selected" button — the only way to
 * delete a code. Permanently removes each selected code AND all of its conversation
 * data (threads, messages, attribution) via `deleteCodesAndData`. Teacher-only but
 * NOT owner-only: any effective teacher may delete any code (finer-grained RBAC is
 * planned). Idempotent; revalidates the list on success.
 */
export async function deleteSelectedCodesAction(codes: string[]): Promise<DeleteSelectedResult> {
  const gate = await requireTeacherUserId();
  if (!gate.ok) {
    return {
      ok: false,
      message:
        gate.reason === "not-teacher"
          ? "Only teachers can delete codes."
          : "Your session carries no user id — sign in again.",
    };
  }

  const result = await deleteCodesAndData(codes);
  if (!result.ok) {
    return {
      ok: false,
      message: "Some data could not be deleted. Try again — deletion is safe to repeat.",
    };
  }

  revalidatePath("/codes");
  return { ok: true, deleted: result.deleted };
}

/**
 * Saves edits to a code's availability window and note. Teacher-only (any
 * effective teacher, RBAC planned). The file URL is NOT editable — it is read
 * from the stored row (frozen, along with the `anonymous` flag it implies), so no
 * YAML re-validation is needed; only the window + note are re-validated. `code` is
 * bound by the edit form; `useActionState` supplies `(prev, formData)`.
 */
export async function updateCodeAction(
  code: string,
  _prev: CodeFormState,
  formData: FormData,
): Promise<CodeFormState> {
  const gate = await requireTeacherUserId();
  if (!gate.ok) {
    return {
      status: "error",
      message:
        gate.reason === "not-teacher"
          ? "Only teachers can edit codes."
          : "Your session carries no user id — sign in again.",
    };
  }

  const entry = await getCode(code);
  if (entry === undefined) {
    return { status: "error", message: "The code could not be checked right now — try again." };
  }
  if (entry === null) {
    return { status: "error", message: "This code no longer exists. Reload the list." };
  }

  // Reuse the create-time validator with the STORED url (which is already
  // normalized, so it passes) — it also validates the window + note + the LLM
  // override pair (editable here, unlike the frozen module/file URL).
  const validation = validateCodeRequest({
    file: entry.fileUrl,
    start: formData.get("startTs"),
    end: formData.get("endTs"),
    note: formData.get("note"),
    llmProvider: formData.get("llmProvider"),
    llmModel: formData.get("llmModel"),
  });
  if (!validation.ok) return { status: "error", message: validation.message };

  // Same save-time gate as create: never store an override this server can't serve.
  if (validation.payload.llm) {
    const unavailable = providerUnavailableReason(validation.payload.llm.provider);
    if (unavailable) return { status: "error", message: unavailable };
  }

  const result = await updateCode(code, {
    validFrom: validation.payload.validFrom,
    validUntil: validation.payload.validUntil,
    note: validation.payload.note,
    llm: validation.payload.llm,
  });
  if (!result.ok) {
    return {
      status: "error",
      message:
        result.reason === "not-found"
          ? "This code no longer exists. Reload the list."
          : "The code could not be saved. Try again.",
    };
  }

  revalidatePath("/codes");
  revalidatePath(`/codes/edit/${code}`);
  return { status: "saved" };
}
