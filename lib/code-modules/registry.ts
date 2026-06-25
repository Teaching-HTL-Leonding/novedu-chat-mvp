import type { RequestContext } from "@mastra/core/request-context";
import type { ReactNode } from "react";
import type { CodeModule } from "@/lib/code-modules/types";
import type { CodeEntry } from "@/lib/code-store";
import type { FileKind } from "@/lib/file-name";
import type { FileValidationResult } from "@/lib/file-validators";
import type { Fetcher } from "@/lib/tutors";
import { quizModule } from "./quiz";
import { tutorModule } from "./tutor";
import { writingModule } from "./writing";

// Layer 3 of the codes architecture: the registry of shareable activities. Each
// descriptor references a `fileKind` (which Layer-2 validator to reuse — never
// redefining validation) and supplies only what is genuinely activity-specific:
// create-time validation, the runtime agent + RequestContext, and the teacher's
// per-code detail body (`renderDetail`, on /codes/[code] — each module owns it).
// STUDENT rendering is NOT a registry seam — it is a thin `switch` in
// app/[code]/page.tsx that delegates to each module's own server component.
// Descriptors keep React/JSX out of this server-only registry by calling server
// components as plain functions (returning ReactNode), never as JSX.
//
// Adding a module touches a small, fixed set of seams: a descriptor file + one
// line in this registry, a client label (lib/code-modules/types.ts), a student
// render case (the thin switch in app/[code]/page.tsx), a teacher `renderDetail`,
// and — for a NEW file kind — that kind's validator + anonymous-read in the
// FileKind layer (lib/file-validators.ts). The GENERIC flow never changes: the
// code store, the runtime route, and attribution all dispatch by `module`/
// `fileKind` and stay untouched. A pure library kind (e.g. `fragment`) adds only a
// Layer-2 validator and no entry here — the asymmetry the `fragment` kind proves.
//
// SERVER-ONLY. Never import from client components (use lib/code-modules/types
// for the client-safe module union + labels).

export interface CodeModuleRuntime {
  /** The single Mastra agent this module's runtime branch runs (the grader is never here). */
  agentId: string;
  /**
   * Builds the per-request RequestContext (system prompt + model the agent reads)
   * from the code row, loading the activity YAML as needed. A load failure returns
   * a status + message the runtime route forwards verbatim.
   */
  buildRequestContext(
    entry: CodeEntry,
  ): Promise<
    { ok: true; context: RequestContext } | { ok: false; status: number; message: string }
  >;
}

export interface CodeModuleDef {
  /** Which Layer-2 validator this module reuses for create-time validation. */
  fileKind: FileKind;
  /** Create-time validation — literally `fileValidators[fileKind].validate`. */
  validateOnCreate(fileUrl: string, fetcher: Fetcher): Promise<FileValidationResult>;
  runtime: CodeModuleRuntime;
  /**
   * Renders the teacher's per-code detail body on /codes/[code]. Each module owns
   * its detail entirely — there is no shared "generic stats shell" a module
   * overrides; tutor/quiz share the `ConversationStats` component by calling it,
   * and writing renders its savers list. `searchParams` are the page's resolved
   * query params; a module reads only what it needs (e.g. writing's savers filter `q`).
   */
  renderDetail(
    entry: CodeEntry,
    searchParams: { [key: string]: string | string[] | undefined },
  ): Promise<ReactNode>;
}

export const codeModules: Record<CodeModule, CodeModuleDef> = {
  tutor: tutorModule,
  quiz: quizModule,
  writing: writingModule,
};
