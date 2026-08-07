import { type Coding, parseCoding } from "@/lib/coding-yaml";
import {
  assembleFragmentPrompt,
  EMPTY_FRAGMENT_BLOCK,
  type Fetcher,
  type LoadOptions,
} from "@/lib/prompt-fragments";

// The coding RUNTIME resolution: render the teacher's `instructions` host text (with any
// inline `{{fragment}}` / `{{file}}` markers resolved in place) into the final
// `instructions` — the system prompt the proxy folds into the upstream request
// (`buildUpstreamChatBody`, lib/coding-proxy.ts).
//
// PURE / fetcher-injected, split out of `lib/coding-fetch.ts` so the SAME resolution
// serves both callers with no second implementation:
//
//   - the app (`loadCoding`), through the DB-backed `loadAppHostedYaml`,
//   - the prompt dump / CLI (`loadCodingFrom`), through the CLI's `file:`-aware fetcher.
//
// Assembly lives in this load layer, never in `lib/llm/endpoint.ts` (which stays
// provider-blind + side-effect-free — see docs/coding.md). No DB, no `app/`, no
// `"use server"`.

export type LoadCodingResult = { ok: true; coding: Coding } | { ok: false; message: string };

const DEFAULT_SCHEMES = ["http:", "https:"];

function schemeAllowed(url: string, allowed: string[]): boolean {
  try {
    return allowed.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Resolve a leniently parsed coding activity into the runnable one. Per-request
 * streaming hot path: consistency over the referenced fragments only
 * (`validateLibraries: false`); no extra passes.
 */
export async function resolveCoding(
  coding: Coding,
  url: string,
  fetcher: Fetcher,
  opts: Pick<LoadOptions, "allowedSchemes"> = {},
): Promise<LoadCodingResult> {
  const resolved = await assembleFragmentPrompt(
    coding.fragmentBlock,
    url,
    fetcher,
    { validateLibraries: false, allowedSchemes: opts.allowedSchemes ?? DEFAULT_SCHEMES },
    coding.instructions,
  );
  if (!resolved.ok) {
    // Fail closed — the proxy surfaces this as its existing upstream-load error.
    return { ok: false, message: "This coding activity's prompt fragments could not be loaded." };
  }
  return {
    ok: true,
    coding: {
      ...coding,
      fragmentBlock: EMPTY_FRAGMENT_BLOCK,
      instructions: resolved.prompt,
    },
  };
}

/**
 * Fetch + lenient-parse + `resolveCoding`, all through the CALLER's fetcher — the
 * app-free counterpart of `loadCoding` (`lib/coding-fetch.ts`) used by the prompt dump
 * and the CLI, where there is no database and an activity may live on disk (`file:`).
 */
export async function loadCodingFrom(
  url: string,
  fetcher: Fetcher,
  opts: Pick<LoadOptions, "allowedSchemes"> = {},
): Promise<LoadCodingResult> {
  const allowedSchemes = opts.allowedSchemes ?? DEFAULT_SCHEMES;
  if (!schemeAllowed(url, allowedSchemes)) {
    return { ok: false, message: `This coding activity's URL is not allowed: ${url}` };
  }
  try {
    const res = await fetcher(url);
    if (!res.ok) {
      return res.status === 404
        ? { ok: false, message: "This coding activity could not be found." }
        : { ok: false, message: `This coding activity could not be loaded (HTTP ${res.status}).` };
    }
    const parsed = parseCoding(await res.text());
    if (!parsed.ok) return parsed;
    return await resolveCoding(parsed.coding, url, fetcher, { allowedSchemes });
  } catch {
    return { ok: false, message: "This coding activity could not be loaded. Try again." };
  }
}
