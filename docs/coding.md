# Coding

Deep reference for the **coding** activity module: an **OpenAI-compatible Chat
Completions endpoint** that an external coding agent (e.g.
[little-coder](https://github.com/itayinbarr/little-coder)) points at, so a student
codes against a model on the SCCH server with a teacher-authored system prompt
layered on. It slots into the generic **codes** subsystem through the fixed seams
that subsystem exposes (`docs/codes.md`) — the generic flow (code store, create,
list, edit, bulk-delete, the availability window) is untouched. The always-on
invariants are summarized in `AGENTS.md`; this file has the full mechanics.

Read it before touching the coding libs (`lib/coding-*.ts`, `lib/llm/endpoint.ts`),
the public route (`app/api/coding/**`), the student surface
(`app/[code]/render-coding.tsx`, `app/[code]/_coding/**`), the descriptor
(`lib/code-modules/coding.ts`), the `api/coding` matcher in `proxy.ts`, or the
samples (`activities/coding/*.yaml`).

## What it is, and what it is NOT

- A teacher mints a `novedu_codes` row with `module: "coding"` pointing at a coding
  YAML, exactly like any other code (`/codes/new`). **The code string IS the API
  key.** The student configures a coding agent with three things — base URL, key,
  model — and codes.
- Unlike tutor/quiz/writing it has **no in-app chat**: there is no CopilotKit
  runtime agent and no Mastra memory. The `/<code>` web page is just a **connection
  page** showing how to point a tool at the endpoint.
- It is a **thin pass-through proxy**, not an agent. Both upstreams (SCCH and Azure
  Foundry, selected by the YAML's `llm.provider` — docs/ai-models.md) are
  OpenAI-compatible; the route gatekeeps, injects the teacher's system prompt, pins
  the model, lets the provider's `adaptBody` hook adjust the **parameter dialect**
  (Azure Foundry renames `max_tokens` → `max_completion_tokens` and drops
  `temperature`/`top_p`, which its gpt-5.x reasoning deployments reject; SCCH is the
  identity — the hook lives in `lib/llm/endpoint.ts`, so the route stays
  provider-blind), and **pipes the response stream back unparsed**. Because the rest
  of the body is forwarded verbatim and the response is never re-serialized,
  **client-side tool calling and streaming work unchanged** (the coding agent runs
  its own file-edit / run-code tools and just exchanges `tool_calls` / `tool`
  messages through the relay).

## Access & anonymity (the security model)

- The endpoint is **public** (no Entra session — an external tool has none). It is
  excluded from the `proxy.ts` gate alongside `/api/files` (anchored `api/coding(?:/|$)`
  so the exclusion can't widen to a future `/api/coding-*` route), and is authenticated
  by the **code as the bearer key**: `Authorization: Bearer <code>` (the code is the
  verbatim key — no prefix is stripped). `checkCode()` re-verifies existence + the
  availability window on **every** request — the same single boundary every module
  shares, never a bare lookup. A non-`coding` code is rejected with the same opaque 401
  as an unknown key.
- It is **always anonymous**: the API path carries no `oid`, so there is no
  attribution, no `novedu_user_chats` row, and no per-student review. `readAnonymousFlag("coding")` returns `{ anonymous: true, definitive: true }` and the
  validator freezes `anonymous: true` onto the row.
- The teacher's **system prompt and the real pinned model stay server-side** — the
  proxy injects the prompt and pins the model; neither is sent to the browser (nor
  is the provider). The connection page deliberately advertises only a generic
  model id (the proxy ignores whatever model the client sends).

## The coding YAML

Authored in `/files` (kind **Coding**), convention-aligned with the other modules:

```yaml
id: beginner-typescript
name: "Beginner TypeScript Coding Buddy"
title: "TypeScript Coding Buddy (Beginners)"   # optional — shown on the connection page
llm:
  model: RedHatAI/gemma-4-31B-it-FP8-Dynamic   # the single pinned model
  # provider: Azure Foundry                    # optional; missing ⇒ SCCH
instructions: |
  <the teacher's system prompt — appended after the coding tool's own system prompt
   so it has the final word>
```

- **`parseCoding`** (`lib/coding-yaml.ts`) is the lenient runtime read: it requires
  only `llm.model` + `instructions` and returns `{ title?, model, provider, instructions }`
  (`provider` defaults to SCCH when missing; a present-but-invalid value is
  rejected). `model`, `provider` and `instructions` are **server-only**.
- **Authoring validation** is the strict `CodingYamlSchema` gate
  (`lib/coding-schema.ts` is the source of truth) run by `loadAndCheckCoding`
  (`lib/coding-validate.ts`): bad YAML, a missing/misspelled field, no `llm.model`, or
  no `instructions` returns `ok: false` with a `CODING_SCHEMA_ERROR` and **blocks the
  save**, exactly like tutor/quiz/writing. The schema is `strictObject`, so it also
  rejects fields coding does not have — including `anonymous` (coding is always
  anonymous), `description`, and `placeholder`. The seam (`lib/file-validators.ts`)
  freezes `anonymous: true` onto the row regardless. `activities/coding/coding-yaml.schema.json`
  is the hand-maintained JSON-Schema mirror for editor IntelliSense (a modeline
  points each coding YAML at its raw GitHub URL).
- `activities/coding/beginner-typescript.yaml` is the shipped sample: a buddy constrained to a
  beginner's knowledge (primitive types only, no OOP/classes, `if` + basic loops, no
  arrow functions, full type annotations). It is demo content — no test reads it
  (docs/testing.md); the validation tests exercise the synthetic fixtures under
  `test-fixtures/activities/coding/`.

## The proxy route

`app/api/coding/v1/chat/completions/route.ts` (`POST`, `dynamic = "force-dynamic"`):

1. `parseBearerKey` reads the code from `Authorization` (the verbatim token — nothing
   stripped). An oversized body (`Content-Length` over `MAX_BODY_BYTES`, 2 MiB) is
   rejected with `413` before any DB work.
2. `checkCode(code)` → `401` unknown / `403` outside window / `503` lookup failure;
   a non-`coding` module → `401`.
3. `loadCoding(entry.fileUrl)` (`lib/coding-fetch.ts`, via the shared
   `appHostedFetcher`) → `502` on failure.
4. `resolveChatEndpoint(loaded.coding.provider)` resolves the upstream and **starts**
   the `authHeader()` acquisition (the SCCH key, or a bounded Entra token for Foundry
   — docs/ai-models.md) so the token round trip overlaps the body read; a missing env
   var or a failed acquisition is a distinct `500` (a real misconfiguration) rather
   than a misleading `502`. `lib/llm/endpoint.ts` is side-effect-free — it does
   **not** import `app/mastra/scch.ts`, whose top-level model fetch must not run on
   this lean public path.
5. `buildUpstreamChatBody` (`lib/coding-proxy.ts`) **appends** the teacher's
   `instructions` to the **end** of the client's own system message (so the teacher
   has the final word; if the client sent no system message, a leading one carrying
   only the teacher's prompt is added) and **pins** `model`; everything else
   (`messages`, `tools`, `tool_choice`, `stream`, …) passes through verbatim. The
   endpoint's `adaptBody` hook then adjusts the provider's parameter dialect (see
   above) — it never touches `stream`/`stream_options`, which carry the usage tap's
   `include_usage`.
6. `fetch` to the resolved URL with the awaited auth header, passing
   `signal: req.signal` so a client disconnect cancels the upstream generation.
7. `return new Response(upstream.body, …)` — copies the upstream `content-type` so
   streamed `text/event-stream` and non-streamed JSON both pass through; the SSE body
   is piped back **unparsed**. Upstream error statuses/bodies pass through as-is.

Errors use the OpenAI envelope `{ error: { message, type, code, param } }`
(`openaiError`).

## Surfaces

The little-coder connection block (`_coding/coding-connection.tsx`: base URL
(`<origin>/api/coding/v1`), the key, the model ref, a ready-to-paste `models.json`
snippet, a run command — each with a copy button — plus a link to little-coder's
*configuring models* docs) is **shared by all three coding surfaces** below. It
receives only non-secret values; the system prompt + real model never reach it.

- **Student `/<code>`** (`render-coding.tsx`, Entra-gated web view): the connection
  block under the activity title.
- **Teacher `/codes/[code]`** (`_coding/coding-detail.tsx`, the module's
  `renderDetail`): the resolved config (pinned model + the server-only system prompt,
  teacher-only) plus the connection block. There are no conversations to review.
- **Create/edit `/codes/edit/[code]`** (`_coding/coding-result.tsx`, the module's
  `renderResult`): the connection block **instead of** the share link the other
  modules show — a coding code is an API key, not a web link.

## Pointing little-coder at it

`little-coder` (built on `pi`) is config-driven. Add a provider to
`~/.config/little-coder/models.json`:

```json
{
  "providers": {
    "novedu": {
      "api": "openai-completions",
      "baseUrl": "https://<host>/api/coding/v1",
      "apiKey": "<the-code>",
      "models": [{ "id": "coding", "name": "Novedu coding", "reasoning": false,
        "input": ["text"], "contextWindow": 32768, "maxTokens": 4096,
        "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 } }]
    }
  }
}
```

Then run, e.g. `little-coder --model novedu/coding -p "Write a Python program that …"`
(`-nt` disables tools for a pure chat-completion smoke test). The `models.json`
`model` id is arbitrary — the proxy pins the teacher's model server-side.

## Testing

- Hermetic unit tests: `parseCoding` (incl. the shipped sample) `lib/coding-yaml.unit.test.ts`;
  the strict authoring validator (schema errors, the always-anonymous mapping)
  `lib/coding-validate.unit.test.ts`; the pure proxy helpers (`buildUpstreamChatBody`,
  `parseBearerKey`, `openaiError`) `lib/coding-proxy.unit.test.ts`; the descriptor + the
  validator seam + the `readAnonymousFlag` branch (`lib/code-modules/coding.unit.test.ts`,
  `lib/file-validators.unit.test.ts`). The `@novedu/cli validate --kind coding` path is
  covered in `cli/src/commands/validate.unit.test.ts`.
- HTTP-level **integration test** of the endpoint
  (`app/api/coding/v1/chat/completions/route.unit.test.ts`, node env): drives the
  real `POST` with `Request`s and a mocked SCCH `fetch` — auth/window gating,
  non-coding rejection, the forwarded body transform, OpenAI error shapes, and both
  non-streamed JSON and streamed SSE passthrough.
- The real end-to-end path against SCCH is exercised by driving `little-coder`
  against a dev server (SCCH is reachable locally; the live LLM leg is not run in CI).

## Future work (deferred)

- **Model allowlist + `GET /api/coding/v1/models`**: let the teacher permit several
  SCCH models and honor the client's `model` when allowed, exposing the list.
- **Per-key rate limiting** (`429`) to shield the SCCH GPU from a leaked key.
- **Usage metrics** (request count / token usage) on the teacher detail page.
