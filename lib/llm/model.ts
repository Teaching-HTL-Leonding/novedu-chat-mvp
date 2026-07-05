import { createOpenAI } from "@ai-sdk/openai";
import { scchProvider } from "@/app/mastra/scch";
import { foundryBearerToken, foundryV1Base } from "@/lib/llm/foundry-endpoint";
import { FOUNDRY_PROVIDER_NAME, type LlmProvider } from "@/lib/llm/provider";

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

// `.chat()` pins the Chat Completions API for BOTH providers: vLLM does not serve
// the Responses API, and the Foundry v1 endpoint is used in its OpenAI-compatible
// Chat Completions shape.
export function resolveLanguageModel(provider: LlmProvider, model: string) {
  return provider === "Azure Foundry" ? getFoundryProvider().chat(model) : scchProvider.chat(model);
}
