import { foundryBearerToken, foundryChatCompletionsUrl } from "@/lib/llm/foundry-endpoint";
import type { LlmProvider } from "@/lib/llm/provider";
import { scchAuthHeader, scchChatCompletionsUrl } from "@/lib/scch-endpoint";

// Provider resolution for the RAW Chat Completions path (the coding proxy) — one
// of the few places that branch on `LlmProvider` (see `lib/llm/model.ts` for the
// ai-sdk agent path and `lib/llm/availability.ts`). Deliberately side-effect-free:
// it imports only the two `*-endpoint` modules, NEVER `app/mastra/scch.ts`, whose
// top-level `await fetchModels()` must not run in the lean public coding route.
// Both getters below throw on missing env; the route maps that (and a failed
// token acquisition) to its 500 config-error path.
//
// SERVER-ONLY.

export interface ChatEndpoint {
  /** Upstream `/chat/completions` URL. */
  url: string;
  /** `Authorization` header value — async because Foundry awaits an Entra token. */
  authHeader(): Promise<string>;
  /**
   * Provider-specific request-dialect adaptation, applied by the route AFTER
   * `buildUpstreamChatBody` and immediately before the upstream fetch. Pure, and
   * it MUST NOT touch `stream`/`stream_options` (the usage tap depends on the
   * `include_usage` merge done by `buildUpstreamChatBody`) nor `model`/`messages`.
   * SCCH: identity.
   */
  adaptBody(body: Record<string, unknown>): Record<string, unknown>;
}

/**
 * Azure OpenAI's gpt-5.x reasoning deployments reject the classic sampling
 * dialect: `max_tokens` must be `max_completion_tokens`, and `temperature`/`top_p`
 * only accept their defaults. SCCH's vLLM accepts the classic dialect, so the
 * adaptation lives here — the proxy itself stays provider-blind.
 */
export function adaptFoundryChatBody(body: Record<string, unknown>): Record<string, unknown> {
  return stripSamplingParams(renameMaxTokens(body));
}

function renameMaxTokens(body: Record<string, unknown>): Record<string, unknown> {
  if (!("max_tokens" in body)) return body;
  const { max_tokens, ...rest } = body;
  // A client that already speaks the new dialect wins; the stale field is dropped.
  return "max_completion_tokens" in rest ? rest : { ...rest, max_completion_tokens: max_tokens };
}

function stripSamplingParams(body: Record<string, unknown>): Record<string, unknown> {
  if (!("temperature" in body) && !("top_p" in body)) return body;
  const { temperature: _temperature, top_p: _topP, ...rest } = body;
  return rest;
}

export function resolveChatEndpoint(provider: LlmProvider): ChatEndpoint {
  if (provider === "Azure Foundry") {
    return {
      url: foundryChatCompletionsUrl(),
      authHeader: async () => `Bearer ${await foundryBearerToken()}`,
      adaptBody: adaptFoundryChatBody,
    };
  }
  return {
    url: scchChatCompletionsUrl(),
    authHeader: async () => scchAuthHeader(),
    adaptBody: (body) => body,
  };
}
