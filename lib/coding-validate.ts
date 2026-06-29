import type { FileValidationResult, FileValidator } from "@/lib/file-validators";

// Authoring-time validation for coding YAMLs — NOT IMPLEMENTED YET (placeholder).
//
// Unlike tutor/quiz/writing — each of which has a strict structural authoring gate
// — the coding kind ships with a placeholder gate: it performs no structural checks
// and accepts any file, freezing `anonymous: true` (a coding activity is ALWAYS
// anonymous, because the OpenAI-compatible API path carries no per-student
// identity). This keeps file-save and code-create working so the endpoint is
// usable. The lenient runtime read the proxy actually needs lives in
// `lib/coding-yaml.ts` (`parseCoding`).
//
// TODO(coding): replace the body below with real structural validation (schema,
// required `llm.model` + `instructions`).
//
// SERVER-ONLY: registered in lib/file-validators.ts.
export const codingValidator: FileValidator = {
  async validate(): Promise<FileValidationResult> {
    return { ok: true, warnings: [], title: null, description: null, anonymous: true };
  },
};
