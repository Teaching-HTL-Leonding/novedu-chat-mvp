import { loadAppHostedYaml } from "@/lib/app-hosted-yaml";
import {
  CODING_MODEL_ID,
  type CodingConnectionProps,
  codingBaseUrl,
  DEFAULT_CODING_MODEL_NAME,
} from "@/lib/coding-connection";
import { type Coding, parseCoding } from "@/lib/coding-yaml";

// Loads + leniently parses the coding YAML behind a (verified) code's file_url, via the
// shared `loadAppHostedYaml`, and derives the non-secret connection props the three
// render surfaces hand to `<CodingConnection>`. The single definition the
// OpenAI-compatible proxy route and the student/teacher surfaces all use, so they read
// the same activity the same way. SERVER-ONLY: touches the database and fetches URLs.

export type LoadCodingResult = { ok: true; coding: Coding } | { ok: false; message: string };

export function loadCoding(url: string): Promise<LoadCodingResult> {
  return loadAppHostedYaml(url, parseCoding, "coding activity");
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
