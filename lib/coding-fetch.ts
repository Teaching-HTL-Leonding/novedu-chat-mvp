import { loadAppHostedYaml } from "@/lib/app-hosted-yaml";
import {
  CODING_MODEL_ID,
  type CodingConnectionProps,
  codingBaseUrl,
  DEFAULT_CODING_MODEL_NAME,
} from "@/lib/coding-connection";
import { type Coding, parseCoding } from "@/lib/coding-yaml";
import { assembleFragmentPrompt, EMPTY_FRAGMENT_BLOCK } from "@/lib/prompt-fragments";

// Loads + leniently parses the coding YAML behind a (verified) code's file_url, via the
// shared `loadAppHostedYaml`, and derives the non-secret connection props the three
// render surfaces hand to `<CodingConnection>`. The single definition the
// OpenAI-compatible proxy route and the student/teacher surfaces all use, so they read
// the same activity the same way. SERVER-ONLY: touches the database and fetches URLs.

export type LoadCodingResult = { ok: true; coding: Coding } | { ok: false; message: string };

export function loadCoding(url: string): Promise<LoadCodingResult> {
  return loadAppHostedYaml(
    url,
    parseCoding,
    "coding activity",
    async (parsed, { url, fetcher }) => {
      // Per-request streaming hot path: render `instructions` as the host template with
      // consistency over the referenced fragments only (`validateLibraries: false`); no
      // extra passes. Assembly lives in this load layer, never in `lib/llm/endpoint.ts`
      // (which stays provider-blind + side-effect-free).
      const resolved = await assembleFragmentPrompt(
        parsed.coding.fragmentBlock,
        url,
        fetcher,
        { validateLibraries: false },
        parsed.coding.instructions,
      );
      if (!resolved.ok) {
        // Fail closed — the proxy surfaces this as its existing upstream-load error.
        return {
          ok: false,
          message: "This coding activity's prompt fragments could not be loaded.",
        };
      }
      return {
        ok: true,
        coding: {
          ...parsed.coding,
          fragmentBlock: EMPTY_FRAGMENT_BLOCK,
          instructions: resolved.prompt,
        },
      };
    },
  );
}

/**
 * Derives `<CodingConnection>`'s props from a loaded activity, so the student page,
 * teacher detail, and create/edit result share one derivation (base URL + model-name
 * fallback). The real model + the teacher's prompt never appear here — only `title` (as
 * a display name), the code-as-key, and the generic model id reach the client.
 */
export function codingConnectionProps(
  loaded: LoadCodingResult,
  origin: string,
  code: string,
): CodingConnectionProps {
  return {
    baseUrl: codingBaseUrl(origin),
    apiKey: code,
    modelId: CODING_MODEL_ID,
    modelName: loaded.ok
      ? (loaded.coding.title ?? DEFAULT_CODING_MODEL_NAME)
      : DEFAULT_CODING_MODEL_NAME,
  };
}
