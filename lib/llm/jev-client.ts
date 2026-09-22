import {
  type APIPromise,
  type Questions,
  type RequestOptions,
  type SystemOneRequest,
  type SystemOneResult,
  TypeSafeClient,
  type TypeSafeClientConfig,
} from "@typesafe-ai/sdk";
import { openrouterApiRoot } from "@/lib/llm/openrouter-endpoint";

// Jev — the classifier behind the quiz pre-check (docs/ai-models.md). This is the
// ONE file in the repo that imports `@typesafe-ai/sdk` (grep-guarded in the unit
// test beside it), so the SDK stays behind the `lib/llm/` seam like every other
// piece of LLM connectivity.
//
// A FOURTH CONNECTIVITY SITE, NOT A FOURTH `LlmProvider`: Jev is not selectable
// in any activity's `llm:` block, has no branch in `resolveLanguageModel`,
// `resolveChatEndpoint` or `providerUnavailableReason`, and answers no chat. It
// piggybacks on OpenRouter's key and base URL only — `openrouterApiRoot()` is the
// API root, and the SDK appends its own `/v1/systemone`.
//
// SERVER-ONLY: the key never leaves this process.

/** OpenRouter's alias for the latest Jev; the response reports the versioned id. */
export const JEV_MODEL = "~typesafe/jev-latest";

/**
 * One attempt, no retries (`maxRetries: 0`): a late hint is worse than none — the
 * student's next typing pause asks again anyway.
 */
export const JEV_TIMEOUT_MS = 5000;

/**
 * Builds a client. `overrides` exists for the test's injected `fetch` only — every
 * other setting is fixed here so there is one configuration, not two.
 *
 * The key is read HERE and the throw is ours: `TypeSafeClientConfig.apiKey` is
 * optional and falls back to the SDK's own `TYPESAFE_API_KEY`, so passing an
 * undefined key would let a stray environment variable silently authenticate a
 * deployment that never configured OpenRouter. There is deliberately no `?? ""`
 * fallback (unlike the ai-sdk instance in `lib/llm/model.ts`, which defers to an
 * upstream 401): the feature gate guarantees the key before any caller gets here,
 * so throwing is the correct fail-closed behaviour.
 *
 * `logLevel: "error"` is load-bearing, not taste: the SDK logs request summaries
 * at `info` and full headers and BODIES at `debug` — and the body carries the
 * student's answer and the question's server-only `evaluation`.
 */
export function createJevClient(
  overrides: Pick<TypeSafeClientConfig, "fetch"> = {},
): TypeSafeClient {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  return new TypeSafeClient({
    apiKey,
    baseURL: openrouterApiRoot(),
    defaultModel: JEV_MODEL,
    timeout: JEV_TIMEOUT_MS,
    retry: { maxRetries: 0 },
    logLevel: "error",
    ...overrides,
  });
}

// Lazy and cached for the same three reasons as the OpenRouter ai-sdk provider in
// `lib/llm/model.ts`: a deployment without OpenRouter never constructs it (this
// module is reachable from `lib/quiz-actions.ts`, which every quiz page imports,
// and the constructor above throws without a key); the key is read at first use
// rather than at import (builds and unit tests import server modules with no
// `.env`); and one instance per process keeps the SDK's connection reuse.
let jevClient: TypeSafeClient | undefined;

/** The process-wide client, built on first use. Throws when the key is missing. */
export function getJevClient(): TypeSafeClient {
  jevClient ??= createJevClient();
  return jevClient;
}

/**
 * One `POST /v1/systemone` round trip: named questions answered against a state,
 * no text generation. The request type is structural, so callers (the pure
 * `lib/quiz-precheck.ts`) build it without importing the SDK.
 */
export function askJev<const Q extends Questions>(
  request: SystemOneRequest<Q>,
  options?: RequestOptions,
): APIPromise<SystemOneResult<Q>> {
  return getJevClient().systemOne(request, options);
}
