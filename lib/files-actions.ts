"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { appHostedFetcher } from "@/lib/app-hosted-fetcher";
import { resolveAppOrigin } from "@/lib/app-origin";
import {
  createFile,
  type FileKind,
  getActiveFile,
  isFileKind,
  softDeleteFiles,
  updateFile,
  validateFileName,
} from "@/lib/file-store";
import { filePublicUrl, filesUrlPrefix } from "@/lib/file-url";
import { fileValidators } from "@/lib/file-validators";
import { requireTeacherUserId } from "@/lib/student-mode";
import {
  defaultFetcher,
  type Fetcher,
  type ValidationError,
  type ValidationWarning,
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

// Result of a validate-only action (the standalone "Validate" button): a pass
// carries the non-blocking warnings to surface; a failure reuses the same shape
// as a rejected save (a short message or the full structured error list).
export type ValidateFileResult = { ok: true; warnings: ValidationWarning[] } | FileActionFailure;

type ContentValidation =
  | { ok: true; title: string | null; description: string | null; warnings: ValidationWarning[] }
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
            "Could not determine the app's public address. Set CODE_ORIGIN in the server configuration.",
        },
      ],
    };
  }

  const selfUrl = filePublicUrl(origin, name);
  const prefix = filesUrlPrefix(origin);
  const hostedFetcher = appHostedFetcher(origin);
  const selfFetcher: Fetcher = async (url) => {
    // The file being saved resolves to its UNSAVED buffer; siblings and external
    // fragments go through the shared hosted fetcher (DB for app-hosted, real
    // fetch otherwise).
    if (url.startsWith(prefix)) {
      const refName = decodeURIComponent(url.slice(prefix.length).split(/[?#]/)[0] ?? "");
      if (refName === name) return { ok: true, status: 200, text: async () => content };
    }
    return hostedFetcher(url);
  };

  // Layer 2: the validator keyed by FileKind is the single source of truth for
  // both /files save and code-create (see lib/file-validators.ts). It surfaces
  // the title/description for the denormalized search columns; the `anonymous`
  // flag it also carries is unused here (only code-create freezes it).
  const result = await fileValidators[kind].validate(selfUrl, selfFetcher);
  if (!result.ok) return { ok: false, errors: result.errors };
  return {
    ok: true,
    title: result.title,
    description: result.description,
    warnings: result.warnings,
  };
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
    return {
      ok: false,
      message: "Choose whether this is a tutor, fragment, quiz, writing or coding file.",
    };
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
 * Validates a would-be NEW file WITHOUT storing it — backs the create form's
 * standalone "Validate" button so a teacher can check the YAML without writing a
 * throwaway version. Runs the same preamble as `createFileAction` up to (and
 * including) the YAML validation, but never touches the store. Name uniqueness is
 * NOT checked here — that is enforced only at create time (as before).
 */
export async function validateNewFileAction(input: {
  name: string;
  kind: string;
  content: string;
}): Promise<ValidateFileResult> {
  const gate = await requireTeacherUserId();
  if (!gate.ok) return gateFailure(gate.reason, "validate");

  const nameValidation = validateFileName(input.name);
  if (!nameValidation.ok) return { ok: false, message: nameValidation.message };
  const name = nameValidation.name;

  if (!isFileKind(input.kind)) {
    return {
      ok: false,
      message: "Choose whether this is a tutor, fragment, quiz, writing or coding file.",
    };
  }
  if (typeof input.content !== "string" || input.content.trim() === "") {
    return { ok: false, message: "The file is empty — add some YAML before validating." };
  }

  const validation = await validateFileContent(name, input.kind, input.content);
  if (!validation.ok) return { ok: false, errors: validation.errors };
  return { ok: true, warnings: validation.warnings };
}

/**
 * Validates a new version of an EXISTING file WITHOUT storing it — backs the edit
 * form's standalone "Validate" button. Mirrors `updateFileAction`'s preamble (the
 * kind is read from the active row, never trusted from the client) but never writes.
 */
export async function validateExistingFileAction(
  name: string,
  content: string,
): Promise<ValidateFileResult> {
  const gate = await requireTeacherUserId();
  if (!gate.ok) return gateFailure(gate.reason, "validate");

  if (typeof content !== "string" || content.trim() === "") {
    return { ok: false, message: "The file is empty — add some YAML before validating." };
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
  return { ok: true, warnings: validation.warnings };
}

/** The uniform shape every list's "Delete Selected" action returns. */
export type DeleteSelectedResult = { ok: true; deleted: number } | { ok: false; message: string };

/**
 * Bulk soft-delete behind the files list's "Delete Selected" button — the only way
 * to delete a file. Teacher-only; soft-deletes every selected file in one
 * transaction (`softDeleteFiles`). Revalidates the list on success.
 */
export async function deleteSelectedFilesAction(names: string[]): Promise<DeleteSelectedResult> {
  const gate = await requireTeacherUserId();
  if (!gate.ok) return gateFailure(gate.reason, "delete");
  const userId = gate.userId;

  const result = await softDeleteFiles(names, userId);
  if (!result.ok) {
    return { ok: false, message: "The files could not be deleted. Try again." };
  }

  revalidatePath("/files");
  return { ok: true, deleted: result.deleted };
}

/**
 * Loads raw YAML by URL for the student GUI, so it can pull in a tutor's
 * referenced fragment files and read their parameters (`input_schema`). Resolves
 * all three URL shapes a `fragment_files[].url` can take:
 *   - absolute http(s) — fetched for real;
 *   - relative (e.g. `simple-fragments.yaml`) — resolved against `baseUrl`, the
 *     tutor's own URL, via `new URL(url, baseUrl)`;
 *   - app-hosted (`<origin>/api/files/<name>`) — served from the DB to avoid a
 *     self-loopback fetch (reusing {@link appHostedFetcher}).
 * Returns the raw text plus the resolved absolute URL.
 *
 * SSRF note: like /api/validate-tutor this fetches an arbitrary user-supplied URL
 * server-side; for this prototype we only restrict the scheme to http(s). A
 * production deployment should additionally allow-list hosts / block private IP
 * ranges and disable redirects.
 */
export async function loadYamlFromUrlAction(input: {
  url: string;
  baseUrl?: string;
}): Promise<{ ok: true; content: string; resolvedUrl: string } | { ok: false; message: string }> {
  const gate = await requireTeacherUserId();
  if (!gate.ok) return gateFailure(gate.reason, "load");

  let resolvedUrl: string;
  try {
    resolvedUrl = input.baseUrl ? new URL(input.url, input.baseUrl).toString() : input.url;
  } catch {
    return { ok: false, message: "That URL could not be resolved." };
  }
  if (!/^https?:\/\//i.test(resolvedUrl)) {
    return {
      ok: false,
      message: "Provide a public http(s) URL (or a path relative to the file).",
    };
  }

  // Resolve app-hosted references from the DB; a plain fetch still works for
  // absolute external URLs if the app origin can't be determined.
  let fetcher: Fetcher = defaultFetcher;
  try {
    fetcher = appHostedFetcher(await resolveAppOrigin());
  } catch {
    // origin unknown — keep the plain fetcher
  }

  try {
    const res = await fetcher(resolvedUrl);
    if (!res.ok)
      return { ok: false, message: `The file could not be loaded (HTTP ${res.status}).` };
    return { ok: true, content: await res.text(), resolvedUrl };
  } catch {
    return { ok: false, message: "The file could not be loaded. Check the URL and try again." };
  }
}

/**
 * Loads an app-hosted file's active content by name for the student GUI's edit
 * flow (the file being edited, or a known sibling). Thin wrapper over
 * {@link getActiveFile}.
 */
export async function loadFileFromDbAction(
  name: string,
): Promise<
  | { ok: true; name: string; kind: FileKind; content: string }
  | { ok: false; reason: "not-found" | "error" }
> {
  const gate = await requireTeacherUserId();
  if (!gate.ok) return { ok: false, reason: "error" };

  const file = await getActiveFile(name);
  if (file === undefined) return { ok: false, reason: "error" };
  if (file === null || !isFileKind(file.kind)) return { ok: false, reason: "not-found" };
  return { ok: true, name: file.name, kind: file.kind, content: file.content };
}
