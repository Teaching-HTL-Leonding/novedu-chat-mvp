import type { FileKind } from "@/lib/file-name";
import { loadQuiz } from "@/lib/quiz-fetch";
import { parseQuiz } from "@/lib/quiz-yaml";
import {
  defaultFetcher,
  type Fetcher,
  loadAndBuildTutorPrompt,
  loadAndCheckFragmentFile,
  type ValidationError,
  type ValidationWarning,
} from "@/lib/tutors";
import { loadWriting } from "@/lib/writing-fetch";
import { parseWriting } from "@/lib/writing-yaml";

// Layer 2 of the codes architecture: the validator seam, keyed by `FileKind`.
// This is the SINGLE source of truth for "is this YAML valid, and what metadata
// does it carry," consumed by THREE call sites with different fetchers:
//   - the /files save + standalone Validate button (fetcher resolves the editor
//     buffer + app-hosted siblings — see lib/files-actions.ts),
//   - the code-create flow (fetcher = app-hosted/default; url = the row's file_url),
//   - (the @novedu/cli mirrors the same lib/tutors checks directly).
//
// A module (Layer 3) NEVER redefines validation — it references a `fileKind` and
// reuses that kind's validator. `fragment` lives here with a real validator and
// NO module (the canonical "validator without a module"); a future pure-library
// kind likewise adds only a validator entry.
//
// SERVER-ONLY: pulls in the tutor/quiz loaders. Never import from client components.

export type FileValidationResult =
  | {
      ok: true;
      warnings: ValidationWarning[];
      /** Denormalized title for the search columns (tutor only; null otherwise). */
      title: string | null;
      /** Denormalized description (tutor only; null otherwise). */
      description: string | null;
      /** The activity YAML's privacy flag — code-create freezes this onto the row. */
      anonymous: boolean;
    }
  | { ok: false; errors: ValidationError[] };

export interface FileValidator {
  validate(url: string, fetcher: Fetcher): Promise<FileValidationResult>;
}

// tutor: the THOROUGH authoring gate (every fragment in every referenced library
// is strict-rendered), matching share/create time and the validate page. The
// build result already surfaces title/description/anonymous.
const tutorValidator: FileValidator = {
  async validate(url, fetcher) {
    const result = await loadAndBuildTutorPrompt(url, fetcher, { validateLibraries: true });
    if (!result.ok) return { ok: false, errors: result.errors };
    return {
      ok: true,
      warnings: result.warnings,
      title: result.title ?? null,
      description: result.description ?? null,
      anonymous: result.anonymous ?? true,
    };
  },
};

// fragment: a pure library kind — a real validator, NO module. Carries no
// title/description/anonymous (privacy-safe `true` default is never read: a
// fragment is never a code).
const fragmentValidator: FileValidator = {
  async validate(url, fetcher) {
    const result = await loadAndCheckFragmentFile(url, fetcher);
    if (!result.ok) return { ok: false, errors: result.errors };
    return { ok: true, warnings: result.warnings, title: null, description: null, anonymous: true };
  },
};

const QUIZ_NOT_IMPLEMENTED: ValidationWarning = {
  code: "QUIZ_VALIDATION_NOT_IMPLEMENTED",
  message:
    "Quiz validation is not implemented yet — the file was stored without structural checks.",
};

// quiz: structural validation is still a STUB (never blocks save — a quiz is a
// novedu_files row not structurally validated). It LENIENTLY extracts the
// metadata code-create needs: the privacy flag and a title. A parse failure
// keeps the privacy-safe `anonymous: true` default. A real quiz validator later
// is a one-spot change here, picked up by /files save AND code-create at once.
const quizValidator: FileValidator = {
  async validate(url, fetcher) {
    let anonymous = true;
    let title: string | null = null;
    try {
      const res = await fetcher(url);
      if (res.ok) {
        const parsed = parseQuiz(await res.text());
        if (parsed.ok) {
          anonymous = parsed.quiz.anonymous;
          title = parsed.quiz.title ?? null;
        }
      }
    } catch {
      // Lenient: a fetch/parse failure leaves the privacy-safe defaults in place.
    }
    return { ok: true, warnings: [QUIZ_NOT_IMPLEMENTED], title, description: null, anonymous };
  },
};

const WRITING_NOT_IMPLEMENTED: ValidationWarning = {
  code: "WRITING_VALIDATION_NOT_IMPLEMENTED",
  message:
    "Writing validation is not implemented yet — the file was stored without structural checks.",
};

// writing: structural validation is a STUB exactly like quiz (never blocks save —
// a writing activity is a novedu_files row not structurally validated). It
// LENIENTLY extracts the metadata code-create needs: the privacy flag and a title.
// Writing DEFAULTS `anonymous: false` (the writing divergence), and a parse failure
// keeps that default. A real writing validator later is a one-spot change here,
// picked up by /files save AND code-create at once.
const writingValidator: FileValidator = {
  async validate(url, fetcher) {
    let anonymous = false;
    let title: string | null = null;
    try {
      const res = await fetcher(url);
      if (res.ok) {
        const parsed = parseWriting(await res.text());
        if (parsed.ok) {
          anonymous = parsed.writing.anonymous;
          title = parsed.writing.title ?? null;
        }
      }
    } catch {
      // Lenient: a fetch/parse failure leaves the privacy default (false) in place.
    }
    return { ok: true, warnings: [WRITING_NOT_IMPLEMENTED], title, description: null, anonymous };
  },
};

export const fileValidators: Record<FileKind, FileValidator> = {
  tutor: tutorValidator,
  fragment: fragmentValidator,
  quiz: quizValidator,
  writing: writingValidator,
};

// Runtime-light read of just the activity YAML's `anonymous` flag, keyed by
// FileKind — the attribution path's counterpart to the validators above (no
// library validation, no metadata extraction). `definitive` is false when the
// YAML could not be read or the kind carries no anonymity flag: the caller then
// applies the privacy-safe default (`true`) but does NOT cache it, so a transient
// load failure does not permanently silence attribution. Co-located with the
// validators so each FileKind's privacy semantics live in ONE place (the sole
// caller is lib/user-chat-store.ts).
export async function readAnonymousFlag(
  kind: FileKind,
  fileUrl: string,
): Promise<{ anonymous: boolean; definitive: boolean }> {
  try {
    if (kind === "quiz") {
      const loaded = await loadQuiz(fileUrl);
      if (loaded.ok) return { anonymous: loaded.quiz.anonymous, definitive: true };
    } else if (kind === "tutor") {
      const tutor = await loadAndBuildTutorPrompt(fileUrl, defaultFetcher);
      if (tutor.ok) return { anonymous: tutor.anonymous, definitive: true };
    } else if (kind === "writing") {
      // Writing DEFAULTS `anonymous: false` (the writing divergence). When the YAML
      // could not be read we fall through to the privacy-safe `true` default below
      // (non-definitive, so it is not cached); a successful read carries the file's
      // own flag, which `parseWriting` already defaults to `false` when absent.
      const loaded = await loadWriting(fileUrl);
      if (loaded.ok) return { anonymous: loaded.writing.anonymous, definitive: true };
    }
  } catch (error) {
    console.error("file-validators: reading the activity YAML's anonymous flag failed", error);
  }
  return { anonymous: true, definitive: false };
}
