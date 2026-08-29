import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { scchProvider, stripAssistantReasoning } from "@/app/mastra/scch";
import { foundryBearerToken, foundryV1Base } from "@/lib/llm/foundry-endpoint";
import { openrouterBase } from "@/lib/llm/openrouter-endpoint";
import {
  FOUNDRY_PROVIDER_NAME,
  type LlmProvider,
  OPENROUTER_PROVIDER_NAME,
  SCCH_PROVIDER_NAME,
} from "@/lib/llm/provider";

// Provider resolution for the ai-sdk AGENT path — one of the only two places that
// branch on `LlmProvider` (the other is `lib/llm/endpoint.ts` for the raw coding
// proxy). Every Mastra agent's `model:` resolver calls `resolveLanguageModel`
// with the activity's `llm.provider` + `llm.model` and never learns which
// provider answered. Importing `app/mastra/scch.ts` (with its startup model
// discovery) is fine HERE — only agent modules import this file, never the
// coding route.
//
// SERVER-ONLY.

// Foundry rides the same OpenAI-compatible `createOpenAI(...).chat(model)` shape
// as SCCH; `model` is the deployment name. Auth is an Entra bearer injected per
// request by a custom fetch (streaming-safe, auto-refreshed by
// `foundryBearerToken` — see lib/llm/foundry-endpoint.ts), so the `apiKey` below
// is a placeholder the fetch always overwrites. Built lazily because
// `foundryV1Base()` throws when `AZURE_FOUNDRY_ENDPOINT` is unset — an SCCH-only
// deployment must boot (and chat) without it.
const foundryFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${await foundryBearerToken()}`);
  return fetch(input, { ...init, headers });
};

let foundryProvider: ReturnType<typeof createOpenAI> | undefined;

function getFoundryProvider(): ReturnType<typeof createOpenAI> {
  foundryProvider ??= createOpenAI({
    // The `name` is the metering contract — see lib/llm/provider.ts.
    name: FOUNDRY_PROVIDER_NAME,
    baseURL: foundryV1Base(),
    apiKey: "entra-managed-identity",
    fetch: foundryFetch,
  });
  return foundryProvider;
}

// OpenRouter is a second `@ai-sdk/openai-compatible` INSTANCE beside SCCH's (which
// lives in app/mastra/scch.ts because it also drives the model dropdown) — same
// package, same flags, and for the same reasons (docs/ai-models.md, "Two ai-sdk
// packages"): `includeUsage: true` so streaming calls report tokens to the metering
// exporter, `supportsStructuredOutputs: true` so `response_format: json_schema`
// survives, and `transformRequestBody` so a previous turn's `reasoning_content` is
// not replayed outward. That last hook is the package's behaviour, not SCCH's, so
// the SCCH implementation is IMPORTED rather than copied. Auth is a static key.
// Built lazily so an OpenRouter-less deployment never constructs it — and so the
// key is read at first use, not at import.
let openrouterProvider: ReturnType<typeof createOpenAICompatible> | undefined;

function getOpenrouterProvider(): ReturnType<typeof createOpenAICompatible> {
  openrouterProvider ??= createOpenAICompatible({
    // The `name` is the metering contract — see lib/llm/provider.ts.
    name: OPENROUTER_PROVIDER_NAME,
    baseURL: openrouterBase(),
    // An unset key makes the first call fail upstream with a 401 rather than here;
    // the authoring/runtime gate (lib/llm/availability.ts) catches it long before.
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    includeUsage: true,
    supportsStructuredOutputs: true,
    transformRequestBody: stripAssistantReasoning,
  });
  return openrouterProvider;
}

// Every branch pins the Chat Completions API — vLLM does not serve the Responses
// API, and the Foundry v1 endpoint is used in its OpenAI-compatible Chat
// Completions shape — but they spell it differently, because the branches come from
// two packages: Foundry's `@ai-sdk/openai` provider exposes `.chat(model)` (its bare
// `provider(id)` would target the Responses API), while the two
// `@ai-sdk/openai-compatible` instances — SCCH and OpenRouter, chosen for that
// package's `reasoning_content` mapping (see app/mastra/scch.ts) — expose
// `.chatModel(model)`.
export function resolveLanguageModel(provider: LlmProvider, model: string) {
  if (provider === "Azure Foundry") return getFoundryProvider().chat(model);
  if (provider === "OpenRouter") return getOpenrouterProvider().chatModel(model);
  return scchProvider.chatModel(model);
}

// The `providerOptions` KEY a caller must file per-request options (today only
// `reasoningEffort` → the wire parameter `reasoning_effort`) under, so they reach
// the model resolved above. It lives HERE, next to the package choice, because
// the key IS a property of the package:
//   - `@ai-sdk/openai` (Foundry) reads its options under the FIXED key "openai",
//     whatever the `createOpenAI({ name })` instance is called;
//   - `@ai-sdk/openai-compatible` (SCCH, OpenRouter) reads them under the INSTANCE
//     NAME — `SCCH_PROVIDER_NAME` / `OPENROUTER_PROVIDER_NAME`, the same constants
//     that yield the `scch.chat` / `openrouter.chat` metering ids.
// A pure lookup, exhaustive over `LlmProvider` by type: it opens no endpoint and
// touches no credential, so it is not one of the three connectivity branches. Its
// one consumer is `app/mastra/model-entry.ts` (docs/ai-models.md).
const REASONING_OPTIONS_KEY: Record<LlmProvider, string> = {
  SCCH: SCCH_PROVIDER_NAME,
  "Azure Foundry": "openai",
  OpenRouter: OPENROUTER_PROVIDER_NAME,
};

export function reasoningOptionsKey(provider: LlmProvider): string {
  return REASONING_OPTIONS_KEY[provider];
}
