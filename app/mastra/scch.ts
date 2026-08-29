import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { SCCH_PROVIDER_NAME } from "@/lib/llm/provider";
import { scchAuthHeader, scchModelsUrl } from "@/lib/scch-endpoint";

// Our self-hosted vLLM GPU server exposes an OpenAI-compatible API.
// Base URL + key live in `.env` (SCCH_BASE_URL, SCCH_API_KEY) and never reach
// the browser — only this server-side module talks to the endpoint. The URL + auth
// header are built by the shared, side-effect-free `lib/scch-endpoint` (the same shape
// the coding proxy uses), so the two can never disagree.
const BASE_URL = process.env.SCCH_BASE_URL;
const API_KEY = process.env.SCCH_API_KEY;

// SCCH rides @ai-sdk/openai-compatible, NOT @ai-sdk/openai, and every option
// below is load-bearing (docs/ai-models.md, "Two ai-sdk packages"):
//
//  - PACKAGE: only this package maps vLLM's `reasoning_content` (streaming
//    `delta.reasoning_content`, non-streaming `message.reasoning_content`) onto
//    ai-sdk reasoning parts — the shape Mastra's reasoning chunks,
//    `@ag-ui/mastra`'s REASONING_* events and the chat's thinking block all
//    consume (docs/chat.md). The @ai-sdk/openai chat parser drops the field.
//  - VERSION: the `2.x` line is the one built on @ai-sdk/provider v3 (ai-sdk v6,
//    what this app runs). npm's `latest` dist-tag on this package is `3.x`, for
//    provider v4, and must NOT be installed — hence the exact pin in package.json.
//  - `includeUsage: true` sends `stream_options.include_usage` on streaming
//    calls; without it no usage numbers reach the Mastra span the metering
//    exporter reads (docs/usage-metering.md).
//  - `supportsStructuredOutputs: true`: vLLM honors OpenAI
//    `response_format: json_schema`, but this package defaults the flag to false
//    and then DROPS the schema, sending a bare `{type: "json_object"}` — which
//    would silently degrade the quiz grader and the eval routes
//    (lib/quiz-verdict-schema.ts).
//  - `transformRequestBody` keeps `reasoning_content` off the OUTGOING history —
//    see `stripAssistantReasoning` below.
//
// `.chatModel()` (via lib/llm/model.ts) pins the Chat Completions API; this
// package serves nothing else, so vLLM's missing Responses API is a non-issue.
// Exported so `lib/llm/model.ts` can resolve an activity's `llm.model` against
// this self-hosted endpoint (the API key never leaves the server). The `name` is
// the metering contract — it yields the provider id `scch.chat` — see
// lib/llm/provider.ts.

/** True for an assistant history message carrying a `reasoning_content` field. */
function carriesReasoning(message: unknown): boolean {
  if (message === null || typeof message !== "object") return false;
  const entry = message as Record<string, unknown>;
  return entry.role === "assistant" && "reasoning_content" in entry;
}

/**
 * Removes `reasoning_content` from the assistant messages of an OUTGOING request
 * body (applied on both the generate and the stream path).
 *
 * The package re-attaches a previous turn's thinking when it converts the history
 * for the next request. Chat Completions requires no such replay, and gemma
 * mis-frames it: on the turn after a tool call it answers INTO `reasoning_content`
 * and leaves `content` empty, so the student sees a blank reply with the real
 * answer hidden in the collapsed thinking block. That tool-call loop is exactly
 * where this bites — the current turn's reasoning is still in memory, upstream of
 * anything Mastra persists (app/mastra/reasoning-processor.ts keeps it out of
 * `mastra_messages`), so the request body is the only place to drop it.
 *
 * UNCONDITIONAL: `model` is free text (docs/ai-models.md), so a per-model branch
 * has nothing reliable to key on, and no house model needs its own scratchpad read
 * back to it. Reasoning RECEIVED is untouched — the thinking block still renders
 * (docs/chat.md). Returns the body it was handed when nothing needs stripping.
 *
 * Exported because the OpenRouter provider (`lib/llm/model.ts`) is a second
 * `@ai-sdk/openai-compatible` instance with the same replay behaviour and needs the
 * same hook — one implementation, not a copy.
 */
export function stripAssistantReasoning(args: Record<string, unknown>): Record<string, unknown> {
  const { messages } = args;
  if (!Array.isArray(messages) || !messages.some(carriesReasoning)) return args;
  return {
    ...args,
    messages: messages.map((message) => {
      if (!carriesReasoning(message)) return message;
      const { reasoning_content: _dropped, ...rest } = message as Record<string, unknown>;
      return rest;
    }),
  };
}

export const scchProvider = createOpenAICompatible({
  name: SCCH_PROVIDER_NAME,
  // The env guard lives in `fetchModels` below (and in the health page): with
  // SCCH_BASE_URL unset the empty base makes the first call throw an invalid-URL
  // error instead of quietly resolving against some default host.
  baseURL: BASE_URL ?? "",
  apiKey: API_KEY,
  includeUsage: true,
  supportsStructuredOutputs: true,
  transformRequestBody: stripAssistantReasoning,
});

// The endpoint also hosts embedding / speech / audio models that can't drive a
// chat. Keep them out of the chat model dropdown.
const NON_CHAT = /embedding|multilingual-e5|voxtral|chatterbox/i;

export interface ScchModel {
  /** Sanitized id — safe as a Mastra agent key and a CopilotKit `agentId`. */
  id: string;
  /** Raw model id as reported by the vLLM `/v1/models` endpoint. */
  model: string;
  /** Human-friendly label for the dropdown. */
  label: string;
}

// Agent keys / agentIds must be free of slashes and dots (e.g. the raw id
// "Qwen/Qwen3.6-27B-FP8"). Map every unsafe char to an underscore.
const sanitize = (modelId: string) => modelId.replace(/[^A-Za-z0-9_-]/g, "_");

async function fetchModels(): Promise<ScchModel[]> {
  if (!BASE_URL || !API_KEY) {
    console.warn("[SCCH] SCCH_BASE_URL or SCCH_API_KEY not set — no SCCH models.");
    return [];
  }
  try {
    // Env is set (guarded above), so these getters won't throw.
    const res = await fetch(scchModelsUrl(), {
      headers: { Authorization: scchAuthHeader() },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data: { id: string }[] };
    return json.data
      .map((m) => m.id)
      .filter((id) => !NON_CHAT.test(id))
      .sort((a, b) => a.localeCompare(b))
      .map((model) => ({ id: sanitize(model), model, label: model }));
  } catch (err) {
    console.warn(`[SCCH] Failed to list models: ${(err as Error).message}`);
    return [];
  }
}

// Resolved once when the server module loads — fetching it also confirms the
// endpoint is reachable. It feeds the model dropdown only: an activity's
// `llm.model` is resolved straight through `scchProvider`, so there is one
// provider rather than one agent per model.
export const scchModels: ScchModel[] = await fetchModels();
