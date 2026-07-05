// High-level orchestration: URL → fetch → parse → validate → consistency →
// assemble, returning a single `BuildResult`. The fetcher is injected so this
// entire pipeline is unit-testable without touching the network.

import { resolveRelativeUrl } from "@/lib/relative-url";
import { assembleSystemPrompt } from "./assemble";
import { checkConsistency } from "./consistency";
import {
  type BuildResult,
  error,
  type FragmentCheckResult,
  type ValidationError,
  type ValidationWarning,
} from "./errors";
import type { Fetcher } from "./fetcher";
import { checkFragmentFileValue, checkFragmentTemplates } from "./fragment";
import { parseYaml, validate } from "./parse";
import { type FragmentFile, FragmentFileSchema, type Tutor, TutorSchema } from "./schemas";

/**
 * Resolve a fragment-file reference to an absolute URL. An absolute http(s) ref is used
 * as-is; anything else is treated as relative to the tutor URL — standard URL resolution
 * drops the tutor's filename and appends the relative path (so `general-fragments.yaml`
 * next to `.../activities/tutors/linked-list-tutor.yaml` becomes `.../activities/tutors/general-fragments.yaml`,
 * and `./` / `../` segments work too). Throws if a relative ref is unparseable; the schema
 * already guarantees the only inputs here are http(s) URLs or relative paths.
 */
export function resolveFragmentUrl(ref: string, tutorUrl: string): string {
  return resolveRelativeUrl(ref, tutorUrl);
}

async function fetchText(
  url: string,
  fetchImpl: Fetcher,
): Promise<{ ok: true; text: string } | { ok: false; error: ValidationError }> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) {
      return {
        ok: false,
        error: error("FETCH_FAILED", `Failed to fetch ${url} (HTTP ${res.status})`, {
          url,
          status: res.status,
        }),
      };
    }
    return { ok: true, text: await res.text() };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: error("FETCH_FAILED", `Failed to fetch ${url}: ${message}`, { url }),
    };
  }
}

/**
 * Options for {@link loadAndBuildTutorPrompt} and {@link loadAndCheckFragmentFile}.
 *
 * `allowedSchemes` constrains which URL schemes the tutor (and its fragment files)
 * may use, defaulting to http(s) only — the server's SSRF guard. The CLI passes
 * `file:` as well so it can validate a tutor/fragment YAML on disk (handed in as a
 * `file://` URL); see `resolveFragmentUrl` for how relative fragment refs then
 * resolve against that local path.
 *
 * `validateLibraries` opts a tutor build INTO the thorough whole-library check:
 * every fragment in every referenced file is strict-rendered against its own
 * `input_schema` (not just the fragments this tutor uses). It defaults to `false`
 * because it runs on the chat HOT PATH (chat start, per-message, attribution) where
 * only the assembled prompt is needed; the authoring gates that should be strict —
 * share time, the validate page/API, and the CLI — pass `true`.
 */
export interface LoadOptions {
  allowedSchemes?: string[];
  validateLibraries?: boolean;
}

const DEFAULT_ALLOWED_SCHEMES = ["http:", "https:"];

/**
 * The shared front of every load: enforce the URL scheme allow-list (SSRF guard),
 * fetch the document, and parse it as YAML — returning the parsed-but-not-yet-schema-
 * validated value or the first structured error. Reused by the tutor builder, the
 * standalone fragment checker, and the quiz/writing validators so they all gate
 * schemes identically.
 */
export async function loadYaml(
  url: string,
  fetchImpl: Fetcher,
  opts: LoadOptions = {},
): Promise<{ ok: true; value: unknown } | { ok: false; error: ValidationError }> {
  const allowedSchemes = opts.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES;

  let scheme: string;
  try {
    scheme = new URL(url).protocol;
  } catch {
    scheme = "";
  }
  if (!allowedSchemes.includes(scheme)) {
    const allowed = allowedSchemes.map((s) => s.replace(/:$/, "")).join("/");
    return { ok: false, error: error("INVALID_URL", `Provide a valid ${allowed} URL`, { url }) };
  }

  const fetched = await fetchText(url, fetchImpl);
  if (!fetched.ok) return { ok: false, error: fetched.error };

  const parsed = parseYaml(fetched.text, url);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  return { ok: true, value: parsed.value };
}

export async function loadAndBuildTutorPrompt(
  url: string,
  fetchImpl: Fetcher,
  opts: LoadOptions = {},
): Promise<BuildResult> {
  const warnings: ValidationWarning[] = [];

  // --- tutor definition ---
  const tutorYaml = await loadYaml(url, fetchImpl, opts);
  if (!tutorYaml.ok) return { ok: false, errors: [tutorYaml.error], warnings };

  const tutorValid = validate<Tutor>(tutorYaml.value, TutorSchema, "TUTOR_SCHEMA_ERROR", url);
  if (!tutorValid.ok) return { ok: false, errors: [tutorValid.error], warnings };
  const tutor = tutorValid.data;

  // --- fragment files (fetched in parallel; surface every failing file at once) ---
  const settled = await Promise.all(
    tutor.prompt.fragment_files.map(
      async (
        ref,
      ): Promise<
        | { alias: string; file: FragmentFile; url: string }
        | { alias: string; error: ValidationError }
      > => {
        // Relative refs are resolved against the tutor URL; absolute http(s) refs pass
        // through. Report errors against the resolved URL (the thing actually fetched).
        let fragmentUrl: string;
        try {
          fragmentUrl = resolveFragmentUrl(ref.url, url);
        } catch {
          return {
            alias: ref.id,
            error: error("INVALID_URL", `Invalid fragment URL: ${ref.url}`, {
              url: ref.url,
              fileAlias: ref.id,
            }),
          };
        }
        const fetched = await fetchText(fragmentUrl, fetchImpl);
        if (!fetched.ok) return { alias: ref.id, error: fetched.error };
        const parsed = parseYaml(fetched.text, fragmentUrl);
        if (!parsed.ok) return { alias: ref.id, error: parsed.error };
        const valid = validate<FragmentFile>(
          parsed.value,
          FragmentFileSchema,
          "FRAGMENT_FILE_SCHEMA_ERROR",
          fragmentUrl,
        );
        if (!valid.ok) return { alias: ref.id, error: { ...valid.error, fileAlias: ref.id } };
        return { alias: ref.id, file: valid.data, url: fragmentUrl };
      },
    ),
  );

  const fragmentFilesByAlias = new Map<string, FragmentFile>();
  const fragmentUrlByAlias = new Map<string, string>();
  const fileErrors: ValidationError[] = [];
  for (const result of settled) {
    if ("error" in result) fileErrors.push(result.error);
    else {
      fragmentFilesByAlias.set(result.alias, result.file);
      fragmentUrlByAlias.set(result.alias, result.url);
    }
  }
  if (fileErrors.length > 0) return { ok: false, errors: fileErrors, warnings };

  // --- thorough whole-library check (opt-in; OFF on the chat hot path) ---
  // Strict-render EVERY fragment in every referenced library against its own
  // input_schema, catching bugs even in fragments this tutor never uses. Duplicate
  // ids are NOT checked here — `checkConsistency` below already reports them.
  const libraryErrors: ValidationError[] = [];
  if (opts.validateLibraries) {
    for (const [alias, file] of fragmentFilesByAlias) {
      const checked = checkFragmentTemplates(file, {
        fileAlias: alias,
        url: fragmentUrlByAlias.get(alias),
      });
      libraryErrors.push(...checked.errors);
      warnings.push(...checked.warnings);
    }
  }

  // --- consistency ---
  const consistency = checkConsistency(tutor, fragmentFilesByAlias);
  warnings.push(...consistency.warnings);
  const preAssemblyErrors = [...libraryErrors, ...consistency.errors];
  if (preAssemblyErrors.length > 0) return { ok: false, errors: preAssemblyErrors, warnings };

  // --- assemble (strict Handlebars backstop) ---
  try {
    const prompt = assembleSystemPrompt(consistency.plan, tutor);
    // Surface the tutor's model alongside the prompt so consumers (the chat
    // route) don't have to re-parse the YAML to learn which model to drive.
    return {
      ok: true,
      prompt,
      model: tutor.llm.model,
      provider: tutor.llm.provider,
      imageInput: tutor.llm.imageInput ?? true,
      anonymous: tutor.anonymous ?? true,
      title: tutor.title,
      description: tutor.description,
      exampleQuestions: tutor.exampleQuestions ?? [],
      warnings,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      errors: [error("ASSEMBLY_ERROR", `Failed to render system prompt: ${message}`)],
      warnings,
    };
  }
}

/**
 * Validate a fragment FILE on its own (the `--kind fragment` / "Fragment library"
 * path): scheme-gate + fetch + parse, then the pure `checkFragmentFileValue`. A
 * fragment library is self-contained, so — unlike a tutor — there are no further
 * files to fetch. The caller already knows it asked for a fragment, so this returns
 * a `FragmentCheckResult` directly (no tutor `BuildResult`, no kind discriminator).
 */
export async function loadAndCheckFragmentFile(
  url: string,
  fetchImpl: Fetcher,
  opts: LoadOptions = {},
): Promise<FragmentCheckResult> {
  const yaml = await loadYaml(url, fetchImpl, opts);
  if (!yaml.ok) return { ok: false, errors: [yaml.error], warnings: [] };
  return checkFragmentFileValue(yaml.value, url);
}
