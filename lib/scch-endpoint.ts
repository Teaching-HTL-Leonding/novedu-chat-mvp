// No-side-effect access to the SCCH OpenAI-compatible endpoint, for the coding
// proxy. Deliberately does NOT import app/mastra/scch.ts — that module runs a
// top-level `await fetchModels()` (a network call) at import, which the lean public
// proxy route must not trigger. `SCCH_BASE_URL` already includes `/v1`, so the
// chat-completions URL is `${SCCH_BASE_URL}/chat/completions`.
//
// SERVER-ONLY.

export function scchChatCompletionsUrl(): string {
  const base = process.env.SCCH_BASE_URL;
  if (!base) throw new Error("SCCH_BASE_URL is not set");
  return `${base}/chat/completions`;
}

export function scchAuthHeader(): string {
  const key = process.env.SCCH_API_KEY;
  if (!key) throw new Error("SCCH_API_KEY is not set");
  return `Bearer ${key}`;
}
