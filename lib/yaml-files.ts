// ============================================================================
// The YAML Files API — the ONE module the student-built GUI imports.
// ============================================================================
//
// This is the single, documented contract between the app and the student GUI
// module (`app/files/gui/_studio/**`). The student GUI must import from here and
// from npm packages only — NEVER from `@/components/*`, `@/app/*`, `@/auth`, the
// database, or any other `@/lib/*`. See `docs/yaml-gui-student-contribution.md`.
//
// It re-exports the SAME functions the existing in-app editor uses, so the GUI
// and the text editor go through one path. Everything here is CLIENT-SAFE:
//   - the *_Action functions are React Server Actions (defined with "use server"
//     in `lib/files-actions.ts`); a client component imports them and `await`s
//     them like normal async functions — they execute on the server;
//   - the rest is pure code (parsing, schemas, types, name helpers).
// Deliberately NO `@/lib/file-store` import here (it is server-only / DB-bound),
// so this module is safe to import from "use client" components.

// --- File name & kind helpers (pure) ----------------------------------------
export {
  FILE_NAME_PATTERN,
  type FileKind,
  type FileNameValidation,
  isFileKind,
  validateFileName,
} from "@/lib/file-name";
// --- Save / update / delete (server actions) --------------------------------
export {
  createFileAction,
  type FileActionFailure,
  loadFileFromDbAction,
  // --- Load YAML: from a URL (DB / relative / external) and from the DB ------
  loadYamlFromUrlAction,
  // --- Result shapes returned by the actions --------------------------------
  type SaveFileResult,
  updateFileAction,
  type ValidateFileResult,
  // --- Validate without saving (server actions) -----------------------------
  validateExistingFileAction,
  validateNewFileAction,
} from "@/lib/files-actions";
export type {
  ErrorCode,
  ValidationError,
  ValidationWarning,
  WarningCode,
} from "@/lib/tutors/errors";
export { formatZodIssues } from "@/lib/tutors/errors";
// The pure fragment-parameter helper — its own module so this barrel never has to
// reach into the Handlebars-based tutor core. See `lib/tutors/fragment-inputs.ts`.
export { getFragmentInputSchema } from "@/lib/tutors/fragment-inputs";
// --- Parse + schemas + formatting (pure runtime helpers) --------------------
// Imported from the tutor-core SUBMODULES (not the `@/lib/tutors` barrel) so the
// Handlebars-based URL validators never get pulled into the client bundle.
export { parseYaml } from "@/lib/tutors/parse";
// --- Types describing the YAML and the validation results (pure, erased) ----
export type {
  ExampleQuestion,
  Fragment,
  FragmentFile,
  FragmentRef,
  InputSchema,
  Tutor,
  VariableValue,
} from "@/lib/tutors/schemas";
export { FragmentFileSchema, TutorSchema } from "@/lib/tutors/schemas";
