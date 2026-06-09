// High-level orchestration: URL → fetch → parse → validate → consistency →
// assemble, returning a single `BuildResult`. The fetcher is injected so this
// entire pipeline is unit-testable without touching the network.

import { assembleSystemPrompt } from "./assemble";
import { checkConsistency } from "./consistency";
import { type BuildResult, error, type ValidationError, type ValidationWarning } from "./errors";
import type { Fetcher } from "./fetcher";
import { parseYaml, validate } from "./parse";
import { type FragmentFile, FragmentFileSchema, type Tutor, TutorSchema } from "./schemas";

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

export async function loadAndBuildTutorPrompt(
  url: string,
  fetchImpl: Fetcher,
): Promise<BuildResult> {
  const warnings: ValidationWarning[] = [];

  if (!/^https?:\/\//i.test(url)) {
    return {
      ok: false,
      errors: [error("INVALID_URL", "Provide a valid http(s) URL", { url })],
      warnings,
    };
  }

  // --- tutor definition ---
  const tutorFetch = await fetchText(url, fetchImpl);
  if (!tutorFetch.ok) return { ok: false, errors: [tutorFetch.error], warnings };

  const tutorYaml = parseYaml(tutorFetch.text, url);
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
        { alias: string; file: FragmentFile } | { alias: string; error: ValidationError }
      > => {
        const fetched = await fetchText(ref.url, fetchImpl);
        if (!fetched.ok) return { alias: ref.id, error: fetched.error };
        const parsed = parseYaml(fetched.text, ref.url);
        if (!parsed.ok) return { alias: ref.id, error: parsed.error };
        const valid = validate<FragmentFile>(
          parsed.value,
          FragmentFileSchema,
          "FRAGMENT_FILE_SCHEMA_ERROR",
          ref.url,
        );
        if (!valid.ok) return { alias: ref.id, error: { ...valid.error, fileAlias: ref.id } };
        return { alias: ref.id, file: valid.data };
      },
    ),
  );

  const fragmentFilesByAlias = new Map<string, FragmentFile>();
  const fileErrors: ValidationError[] = [];
  for (const result of settled) {
    if ("error" in result) fileErrors.push(result.error);
    else fragmentFilesByAlias.set(result.alias, result.file);
  }
  if (fileErrors.length > 0) return { ok: false, errors: fileErrors, warnings };

  // --- consistency ---
  const consistency = checkConsistency(tutor, fragmentFilesByAlias);
  warnings.push(...consistency.warnings);
  if (consistency.errors.length > 0) return { ok: false, errors: consistency.errors, warnings };

  // --- assemble (strict Handlebars backstop) ---
  try {
    const prompt = assembleSystemPrompt(consistency.plan, tutor);
    // Surface the tutor's model alongside the prompt so consumers (the chat
    // route) don't have to re-parse the YAML to learn which model to drive.
    return { ok: true, prompt, model: tutor.llm.model, warnings };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      errors: [error("ASSEMBLY_ERROR", `Failed to render system prompt: ${message}`)],
      warnings,
    };
  }
}
