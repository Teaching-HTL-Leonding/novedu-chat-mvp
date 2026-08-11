# AI models & LLM providers

How the app talks to language models: two OpenAI-compatible providers behind one
isolated seam. Every activity YAML picks its model with `llm.model` and its
provider with `llm.provider` (`"SCCH"` when missing); no other code in the app
knows which provider serves a request. The YAML values are the **default**: a
code may carry a per-code `(provider, model)` **override pair**
(`novedu_codes.llm_provider`/`llm_model`, both-or-nothing) that replaces them for
every request served under that code — the precedence is `effectiveLlm`
(`lib/code-store.ts`), applied at every consumption site (`docs/codes.md`), and
the availability gate below runs on the EFFECTIVE provider. Metering is
unaffected: the exporter reads the actually-resolved provider/model off the span
(the named-provider contract below), and the coding proxy meters its effective
pair explicitly.

Read before touching: `lib/llm/**`, `app/mastra/scch.ts`, `lib/scch-endpoint.ts`,
`buildCognitiveServicesCredential` in `lib/azure-credential.ts`, the `llm:` block
of any activity schema, and the Foundry probe in `lib/health.ts`.

## The two providers

| | SCCH | Azure Foundry |
|---|---|---|
| What | Self-hosted vLLM GPU server (free for us, Austria-only network) | Azure OpenAI resource (paid, e.g. `gpt-5.5`, `gpt-5.4-mini`) |
| Env | `SCCH_BASE_URL` (includes `/v1`) + `SCCH_API_KEY` | `AZURE_FOUNDRY_ENDPOINT` (bare resource endpoint; trailing slash tolerated) |
| API | OpenAI Chat Completions | OpenAI-compatible **v1** surface — `${endpoint}/openai/v1`, no `api-version`, the **deployment name is the `model`** |
| Auth | Static `Bearer ${SCCH_API_KEY}` | **Passwordless Entra** — no API key exists (see below) |
| `llm.model` | Raw model id (e.g. `RedHatAI/gemma-4-31B-it-FP8-Dynamic`) | Deployment name (e.g. `gpt-5.4-mini`) |

`model` is free text for both; a wrong name fails at runtime. There is no live
model discovery for Foundry (SCCH's dropdown discovery in `app/mastra/scch.ts` is
unchanged and SCCH-only). Foundry is **optional**: without
`AZURE_FOUNDRY_ENDPOINT` the app boots and runs SCCH-only — everything Foundry is
built lazily on first use, and `foundryConfigured()` gates the Foundry-specific UI
(the `/health` rows). The optionality is **enforced**: on an SCCH-only server the
authoring gate (`lib/file-validators.ts`) rejects a Foundry file with a
`PROVIDER_UNAVAILABLE` error, and the runtime guards (quiz/writing
`buildRequestContext` → 502, the tutor loader → a thrown reason) catch a Foundry
file that arrives anyway (externally hosted YAML, an env change) — all through
`providerUnavailableReason` (`lib/llm/availability.ts`), so no chat ever dies on a
raw "AZURE_FOUNDRY_ENDPOINT is not set". The CLI never runs this gate — its
bundled `loadAndCheck*` core stays environment-free.

## The `lib/llm/` seam — where the distinction lives

The provider branch exists in exactly **three functions** —
`resolveLanguageModel`, `resolveChatEndpoint` (including its `adaptBody` dialect
hook), and `providerUnavailableReason`; every call site asks one of them and never
learns which provider answered.

- `lib/llm/provider.ts` — pure, client-safe: the `LlmProvider` type, the two
  literals, `DEFAULT_PROVIDER`, the zod `providerSchema` (default `"SCCH"`) all
  four activity schemas embed, `parseLenientProvider` for the lenient runtime
  parsers, and the ai-sdk **provider names** (`"scch"` / `"azure-foundry"`) with
  `providerFromModelProviderId` — the metering contract (below).
- `lib/llm/model.ts` — **the agent path**: `resolveLanguageModel(provider, model)`
  returns an ai-sdk chat model (`scchProvider.chat(model)` or the lazily-built
  Foundry `createOpenAI(...).chat(model)`). Imports `app/mastra/scch.ts`, so only
  agent modules may import it — never the coding route.
- `lib/llm/endpoint.ts` — **the raw path** (the coding proxy):
  `resolveChatEndpoint(provider)` → `{ url, authHeader(): Promise<string>, adaptBody(body) }`.
  Deliberately side-effect-free: it imports only the two `*-endpoint` modules, not
  `app/mastra/scch.ts` (whose top-level model discovery must not run on the lean
  public coding route). `adaptBody` is the **parameter dialect** hook the proxy
  applies after `buildUpstreamChatBody`: Azure's gpt-5.x reasoning deployments
  reject `max_tokens` (it becomes `max_completion_tokens`) and non-default
  `temperature`/`top_p` (dropped), while SCCH's vLLM speaks the classic dialect
  (identity). The hook is pure and never touches `stream`/`stream_options`
  (the usage tap's `include_usage`) or `model`/`messages`.
- `lib/llm/availability.ts` — **the availability check** (app-only, never bundled
  by the CLI): `providerUnavailableReason(provider)` → `null` or a teacher-readable
  reason (Foundry named without `AZURE_FOUNDRY_ENDPOINT`). Consumed by the
  authoring gate and the runtime guards (above).
- `lib/llm/foundry-endpoint.ts` — side-effect-free Foundry access (mirrors
  `lib/scch-endpoint.ts`): URL builders over `AZURE_FOUNDRY_ENDPOINT` (throwing
  only when *called* with it unset) and `foundryBearerToken()`.
- `lib/llm/upstream-error.ts` — **the failure classifier**, provider-AGNOSTIC (it
  interpolates the provider name, never branches on it):
  `classifyUpstreamLlmError(error, { provider, model })` →
  `{ terminal, message, telemetry }`. See "Reporting an upstream failure" below.

Adding a provider = one branch in each of the three functions above + a name
constant/mapping in `provider.ts` + the schema enum literal (+ docs). Nothing else
changes.

## Reporting an upstream failure

When a model call fails, two different audiences need two different things, and
`classifyUpstreamLlmError` (`lib/llm/upstream-error.ts`) is the one place that splits
them. It reads the ai-sdk `APICallError` — `statusCode`, `isRetryable`, and the
OpenAI-shaped `data.error.{code,type}` envelope both providers speak — digging it out
of wrapper errors first (the ai-sdk's `RetryError`, Mastra's `cause` chain), so a
wrapped failure classifies exactly like a raw one.

- **`terminal`** — `true` when the request can never succeed as sent (a deployment name
  that does not exist, a rejected parameter), so the caller answers `4xx` and no client
  retries it. It reuses the ai-sdk's own retryability verdict, which keeps 408/409/**429**
  and 5xx retryable — a rate limit is a 4xx that must NOT become terminal. Neither is an
  upstream `401`/`403`: the provider refusing the *server's* credentials (a rotated key,
  a stale Managed-Identity role) is a server fault a token refresh may cure, so the
  caller gets a `502` that says so and retries stay live.
- **`message`** — caller-safe: the provider and model the caller itself sent, the
  upstream status, and the upstream error *code*. The commonest case, Azure's
  `404 DeploymentNotFound`, gets its own wording because a teacher hits it routinely
  (a wrong `--llm-model`) and can fix it alone — but only a proving code
  (`DeploymentNotFound`, `model_not_found`) earns that claim. A bare `404` is worded to
  cover a misconfigured server endpoint too, and a `content_filter` rejection points at
  the failing text rather than the llm settings.
- **`telemetry`** — the `recordError` attributes, and the ONLY channel for the endpoint
  URL (the Foundry resource host) and, via `recordException`, the provider's free-form
  message. Neither belongs in a response body: the host is infrastructure detail, and
  the free-form field is the one most likely to grow to echo request content. An
  operator reads both in Application Insights (`docs/telemetry.md`).

Consumed by `POST /api/eval/grade` (`docs/api.md`, `docs/cli-eval.md`). The **student**
paths deliberately do NOT use it: a student can neither fix a deployment nor be shown
infrastructure detail, so `lib/quiz-actions.ts` keeps its single generic sentence.

## Foundry auth — Managed Identity with transparent refresh

There is no Foundry API key anywhere. `foundryBearerToken()` holds ONE process-wide
`getBearerTokenProvider(buildCognitiveServicesCredential(), "https://cognitiveservices.azure.com/.default")`
(`@azure/identity`): it caches the token and refreshes it before its ~60-minute
expiry, so callers just await a fresh bearer per request and never hold a token.
(`https://ai.azure.com/.default` also works against `*.openai.azure.com`; the
Cognitive Services scope is the canonical one.) The acquisition itself is
**bounded** (`FOUNDRY_TOKEN_TIMEOUT_MS`, 15 s, via `lib/promise-timeout.ts`): a
stuck `az` subprocess or a black-holed IMDS rejects instead of stalling a request
indefinitely, for every caller at once — the coding proxy, the agents' custom
`fetch`, and the health probe.

`buildCognitiveServicesCredential()` (`lib/azure-credential.ts`) is the same
explicit chain as the data-store credential — `AzureCliCredential` (local
`az login`) → `ManagedIdentityCredential` (on Azure) — and **never**
`DefaultAzureCredential` (same reason: the `AZURE_*` sign-in env vars belong to
user auth, not resource access). RBAC: the identity needs the
**`Cognitive Services OpenAI User`** role (`5e0bd9bd-7b93-4f28-af87-19fc36ad61bd`)
on the Foundry resource — the deployed app's Managed Identity AND each developer's
own account for local dev.

On the agent path, the bearer is injected per request by a custom `fetch` handed to
`createOpenAI` (streaming-safe); on the coding path, the route **starts**
`endpoint.authHeader()` right after the YAML load (so the token round trip overlaps
the client-body read), awaits it before the upstream fetch, and maps a failure
(missing env, no token) to its 500 config-error path.

## Server-only invariant

Endpoints, the SCCH key, and Entra tokens live in server modules only and never
reach the browser — for every module, including the coding proxy (which keeps the
teacher prompt + pinned model server-side, docs/coding.md). `provider` is part of
the activity YAML like `model`: server-read, live, never client-trusted.

## Metering contract — provider names on spans

Both `createOpenAI` instances are **named** (`scch` / `azure-foundry`), so Mastra
stamps `attributes.provider = "<name>.chat"` and `attributes.model` (= the YAML's
`llm.model`) on every MODEL_GENERATION span. The usage exporter reads those
attributes and maps the name back to the app-level label via
`providerFromModelProviderId` — that is how `novedu_usage_by_code` learns its
`provider`/`model` columns (docs/usage-metering.md) with zero per-module wiring.
**Renaming a provider silently breaks that attribution** — the names are constants
in `lib/llm/provider.ts` for exactly this reason. The coding proxy (no Mastra)
passes `loaded.coding.provider`/`model` into `recordLlmUsage` directly.

## Health

`/health` shows Foundry rows only when `AZURE_FOUNDRY_ENDPOINT` is set:
`checkFoundry()` (`lib/health.ts`) proves token acquisition (the RBAC role) and
endpoint reachability (a model listing), testids `health-foundry` /
`health-foundry-host`. An SCCH-only deployment shows no Foundry row at all.

## Testing

- **Hermetic** (`lib/llm/*.unit.test.ts`, CI): the provider schema/mapping, the
  Foundry URL normalization, `resolveChatEndpoint` shapes with a mocked token,
  and `resolveLanguageModel` model ids/provider names (`createOpenAI` does no I/O).
- **Live** (`@live-llm`, local only — CI has no Managed Identity and no SCCH
  network): `e2e/tutor-chat-reply.spec.ts` runs the same smoke once per provider
  (the Foundry leg authors an app-hosted tutor and skips without
  `AZURE_FOUNDRY_ENDPOINT`), and `e2e/health.spec.ts` asserts the `health-foundry`
  probe. See docs/testing.md.
