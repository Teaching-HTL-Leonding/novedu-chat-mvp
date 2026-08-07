import {
  assembleFragmentPrompt,
  EMPTY_FRAGMENT_BLOCK,
  type Fetcher,
  type LoadOptions,
} from "@/lib/prompt-fragments";
import { parseWriting, type Writing } from "@/lib/writing-yaml";

// The writing RUNTIME resolution: render the teacher's `instructions` host text (with any
// inline `{{fragment}}` / `{{file}}` markers resolved in place) into the final
// `instructions` — the system prompt the feedback agent runs with.
//
// PURE / fetcher-injected, split out of `lib/writing-fetch.ts` so the SAME resolution
// serves both callers with no second implementation:
//
//   - the app (`loadWriting`), through the DB-backed `loadAppHostedYaml`,
//   - the prompt dump / CLI (`loadWritingFrom`), through the CLI's `file:`-aware fetcher.
//
// No DB, no `app/`, no `"use server"`.

export type LoadWritingResult = { ok: true; writing: Writing } | { ok: false; message: string };

const DEFAULT_SCHEMES = ["http:", "https:"];

function schemeAllowed(url: string, allowed: string[]): boolean {
  try {
    return allowed.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Resolve a leniently parsed writing activity into the runnable one. `url` is the
 * activity's own URL (the base for relative fragment refs); `fetcher` the network seam.
 */
export async function resolveWriting(
  writing: Writing,
  url: string,
  fetcher: Fetcher,
  opts: Pick<LoadOptions, "allowedSchemes"> = {},
): Promise<LoadWritingResult> {
  const resolved = await assembleFragmentPrompt(
    writing.fragmentBlock,
    url,
    fetcher,
    { validateLibraries: false, allowedSchemes: opts.allowedSchemes ?? DEFAULT_SCHEMES },
    writing.instructions,
  );
  if (!resolved.ok) {
    // Fail closed — same hard-error path as an unfetchable activity YAML.
    return { ok: false, message: "This writing activity's prompt fragments could not be loaded." };
  }
  return {
    ok: true,
    writing: {
      ...writing,
      fragmentBlock: EMPTY_FRAGMENT_BLOCK,
      instructions: resolved.prompt,
    },
  };
}

/**
 * Fetch + lenient-parse + `resolveWriting`, all through the CALLER's fetcher — the
 * app-free counterpart of `loadWriting` (`lib/writing-fetch.ts`) used by the prompt dump
 * and the CLI, where there is no database and an activity may live on disk (`file:`).
 */
export async function loadWritingFrom(
  url: string,
  fetcher: Fetcher,
  opts: Pick<LoadOptions, "allowedSchemes"> = {},
): Promise<LoadWritingResult> {
  const allowedSchemes = opts.allowedSchemes ?? DEFAULT_SCHEMES;
  if (!schemeAllowed(url, allowedSchemes)) {
    return { ok: false, message: `This writing activity's URL is not allowed: ${url}` };
  }
  try {
    const res = await fetcher(url);
    if (!res.ok) {
      return res.status === 404
        ? { ok: false, message: "This writing activity could not be found." }
        : { ok: false, message: `This writing activity could not be loaded (HTTP ${res.status}).` };
    }
    const parsed = parseWriting(await res.text());
    if (!parsed.ok) return parsed;
    return await resolveWriting(parsed.writing, url, fetcher, { allowedSchemes });
  } catch {
    return { ok: false, message: "This writing activity could not be loaded. Try again." };
  }
}
