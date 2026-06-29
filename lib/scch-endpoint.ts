// No-side-effect access to the SCCH OpenAI-compatible endpoint — the SINGLE definition
// of the SCCH URL + auth-header shape, shared by the coding proxy route AND
// app/mastra/scch.ts. Deliberately has NO imports (and app/mastra/scch.ts imports THIS,
// never the reverse): scch.ts runs a top-level `await fetchModels()` at import, which
// the lean public proxy route must not trigger. `SCCH_BASE_URL` already includes `/v1`,
// so endpoint URLs are `${SCCH_BASE_URL}/<path>`. These getters throw on a missing env
// var (the proxy route maps that to a 500); scch.ts guards env itself before calling
// them, since it degrades to an empty model list rather than throwing.
//
// SERVER-ONLY.

function scchBase(): string {
  const base = process.env.SCCH_BASE_URL;
  if (!base) throw new Error("SCCH_BASE_URL is not set");
  return base;
}

export const scchChatCompletionsUrl = (): string => `${scchBase()}/chat/completions`;

export const scchModelsUrl = (): string => `${scchBase()}/models`;

export function scchAuthHeader(): string {
  const key = process.env.SCCH_API_KEY;
  if (!key) throw new Error("SCCH_API_KEY is not set");
  return `Bearer ${key}`;
}
