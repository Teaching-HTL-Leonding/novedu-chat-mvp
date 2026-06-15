"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resolveAppOrigin } from "@/lib/app-origin";
import {
  createFile,
  type FileKind,
  getActiveFile,
  isFileKind,
  softDeleteFile,
  updateFile,
  validateFileName,
} from "@/lib/file-store";
import { filePublicUrl, filesUrlPrefix } from "@/lib/file-url";
import { requireTeacherUserId } from "@/lib/student-mode";
import {
  defaultFetcher,
  type Fetcher,
  loadAndBuildTutorPrompt,
  loadAndCheckFragmentFile,
  type ValidationError,
} from "@/lib/tutors";

// Teacher-only server actions for app-hosted YAML files. Each gates with the
// shared `requireTeacherUserId()`, VALIDATES the YAML before persisting (an
// invalid file is rejected — saving and validity are coupled by design), and
// revalidates the list. Storage lives in `lib/file-store.ts`; this is the thin
// auth + policy shell around it.
//
// A failure is either a plain `message` (auth, name, store) or the structured
// `errors` from the validator (so the UI can show the full, specific list —
// schema field paths, missing variables, fetch failures — not just a generic
// "failed validation").

export type FileActionFailure =
  | { ok: false; message: string }
  | { ok: false; errors: ValidationError[] };

export type SaveFileResult = { ok: true } | FileActionFailure;

type ContentValidation =
  | { ok: true; title: string | null; description: string | null }
  | { ok: false; errors: ValidationError[] };

// Maps the shared teacher-gate failure to a message for these file actions —
// only the verb (create/edit/delete) differs between the call sites.
function gateFailure(
  reason: "not-teacher" | "no-user-id",
  verb: string,
): { ok: false; message: string } {
  return {
    ok: false,
    message:
      reason === "not-teacher"
        ? `Only teachers can ${verb} files.`
        : "Your session carries no user id — sign in again.",
  };
}

/**
 * Validates the in-editor YAML buffer with the SAME core the chat and the
 * /validate-tutor page use, BEFORE anything is stored. The validator is URL-based
 * with an injectable fetcher; we intercept references to app-hosted files
 * (`<origin>/api/files/<name>`) and resolve them WITHOUT a network round-trip:
 *   - the file being saved resolves to its unsaved buffer, and
 *   - a sibling hosted file (`./other` → `<origin>/api/files/other`) resolves
 *     from the database directly — no loopback fetch to our own public origin
 *     (which a container may not even be able to reach), and no fragility around
 *     an exact self-URL string match.
 * Everything else (e.g. a fragment hosted on GitHub) is fetched for real.
 * On success it returns the tutor's title/description (null for fragments) for the
 * denormalized search columns; on failure, the full structured error list.
 */
async function validateFileContent(
  name: string,
  kind: FileKind,
  content: string,
): Promise<ContentValidation> {
  let origin: string;
  try {
    origin = await resolveAppOrigin();
  } catch {
    return {
      ok: false,
      errors: [
        {
          code: "INVALID_URL",
          message:
            "Could not determine the app's public address. Set TUTOR_CODE_ORIGIN in the server configuration.",
        },
      ],
    };
  }

  const selfUrl = filePublicUrl(origin, name);
  const prefix = filesUrlPrefix(origin);
  const selfFetcher: Fetcher = async (url) => {
    if (url.startsWith(prefix)) {
      // A reference to an app-hosted file — serve the buffer (this file) or the
      // active version from the DB (a sibling) instead of fetching our own origin.
      const refName = decodeURIComponent(url.slice(prefix.length).split(/[?#]/)[0] ?? "");
      if (refName === name) return { ok: true, status: 200, text: async () => content };
      const sibling = await getActiveFile(refName);
      if (sibling) return { ok: true, status: 200, text: async () => sibling.content };
      return { ok: false, status: 404, text: async () => "" };
    }
    return defaultFetcher(url);
  };

  if (kind === "fragment") {
    const result = await loadAndCheckFragmentFile(selfUrl, selfFetcher);
    if (!result.ok) return { ok: false, errors: result.errors };
    return { ok: true, title: null, description: null };
  }

  // tutor: the THOROUGH authoring gate (every fragment in every referenced
  // library is strict-rendered), matching share time and the validate page.
  const result = await loadAndBuildTutorPrompt(selfUrl, selfFetcher, { validateLibraries: true });
  if (!result.ok) return { ok: false, errors: result.errors };
  return { ok: true, title: result.title ?? null, description: result.description };
}

/**
 * Creates a new hosted file (version 1). Validates the name, the chosen kind, and
 * the YAML; on success stores it and redirects to its edit page. Called directly
 * (not as a form action) so the create form keeps its entered fields on failure.
 */
export async function createFileAction(input: {
  name: string;
  kind: string;
  content: string;
}): Promise<FileActionFailure> {
  const gate = await requireTeacherUserId();
  if (!gate.ok) return gateFailure(gate.reason, "create");
  const userId = gate.userId;

  const nameValidation = validateFileName(input.name);
  if (!nameValidation.ok) return { ok: false, message: nameValidation.message };
  const name = nameValidation.name;

  if (!isFileKind(input.kind)) {
    return { ok: false, message: "Choose whether this is a tutor or a fragment file." };
  }
  if (typeof input.content !== "string" || input.content.trim() === "") {
    return { ok: false, message: "The file is empty — add some YAML before creating it." };
  }

  const validation = await validateFileContent(name, input.kind, input.content);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const stored = await createFile(
    {
      name,
      kind: input.kind,
      content: input.content,
      title: validation.title,
      description: validation.description,
    },
    userId,
  );
  if (!stored.ok) {
    return {
      ok: false,
      message:
        stored.reason === "name-taken"
          ? "A file with that name already exists. Choose another name."
          : "The file could not be stored. Try again, or contact the operator.",
    };
  }

  revalidatePath("/files");
  redirect(`/files/edit/${name}`);
}

/**
 * Saves a new version of an existing file. Re-validates against the file's stored
 * kind and blocks the save if invalid. Called from the edit form's Save button.
 */
export async function updateFileAction(name: string, content: string): Promise<SaveFileResult> {
  const gate = await requireTeacherUserId();
  if (!gate.ok) return gateFailure(gate.reason, "edit");
  const userId = gate.userId;

  if (typeof content !== "string" || content.trim() === "") {
    return { ok: false, message: "The file is empty — add some YAML before saving." };
  }

  const active = await getActiveFile(name);
  if (active === undefined) {
    return { ok: false, message: "The file could not be checked right now — try again." };
  }
  if (active === null || !isFileKind(active.kind)) {
    return { ok: false, message: "This file no longer exists. Reload the list." };
  }

  const validation = await validateFileContent(name, active.kind, content);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const result = await updateFile(
    name,
    { content, title: validation.title, description: validation.description },
    userId,
  );
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.reason === "not-found"
          ? "The file changed or was removed by someone else. Reload and try again."
          : "The file could not be saved. Try again.",
    };
  }

  revalidatePath("/files");
  revalidatePath(`/files/edit/${name}`);
  return { ok: true };
}

/**
 * Soft-deletes a file. Idempotent: an already-gone file reports success so the
 * row clears from the list. Revalidates the list on completion.
 */
export async function deleteFileAction(
  name: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const gate = await requireTeacherUserId();
  if (!gate.ok) return gateFailure(gate.reason, "delete");
  const userId = gate.userId;

  const result = await softDeleteFile(name, userId);
  if (!result.ok && result.reason === "error") {
    return { ok: false, message: "The file could not be deleted. Try again." };
  }

  revalidatePath("/files");
  return { ok: true };
}
