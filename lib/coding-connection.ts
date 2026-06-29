// Client-safe constants for the coding module's OpenAI-compatible endpoint. PURE — no
// imports, no I/O — so the server render surfaces (student page, teacher detail,
// create/edit result) AND the client `/codes` copy button share ONE source of truth for
// the endpoint path, the pinned model id, and the default model name. They can never
// drift: change the route path or default name here and every surface follows.
//
// Carries only non-secret values — the teacher's system prompt and the real SCCH model
// never appear here (the proxy applies them server-side).

/** Path segment the external coding agent points at: `<origin>/api/coding/v1`. */
export const CODING_API_PATH = "/api/coding/v1";

/** The generic model id the client sends; the proxy pins the real SCCH model. */
export const CODING_MODEL_ID = "coding";

/** Display name shown when the activity YAML has no `title`. */
export const DEFAULT_CODING_MODEL_NAME = "Novedu coding";

export const codingBaseUrl = (origin: string): string => `${origin}${CODING_API_PATH}`;

/** The non-secret props `<CodingConnection>` renders. */
export interface CodingConnectionProps {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  modelName: string;
}
