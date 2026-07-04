# Usage metering

Per-hour usage accounting: token counts, tool calls, and discrete activity counts,
attributed **either** to a code **or** to a user — never both at once. Backs cost /
operational monitoring now and per-student token quotas later. `usage_by_code` has a
read surface — the teacher usage dashboard at `/usage` (`docs/dashboard.md`);
`usage_by_user` has none yet, so query it directly (SQL / Log Analytics).

Read before touching: `lib/usage-store.ts`, `app/mastra/usage-exporter.ts`,
`lib/usage-context-keys.ts`, the `observability` block in `app/mastra/index.ts`, and
the capture points in `app/api/copilotkit/[[...slug]]/route.ts`, `lib/quiz-actions.ts`,
`lib/writing-actions.ts`, and `app/api/coding/v1/chat/completions/route.ts` +
`lib/coding-proxy.ts`.

## The two tables (and why two)

`novedu_usage_by_code` (PK `code, hour`, plus a denormalized `module`) and
`novedu_usage_by_user` (PK `user_id, hour`) are stored **independently**. There is
deliberately **no `(hour × code × user)` fact table**.

The app is anonymous-by-default (tutor/quiz default `anonymous: true`;
`novedu_user_chats` is written only when a code opts out — see `docs/codes.md`).
Storing "user X used N tokens **on code Y**" would recreate exactly the user↔code
link the anonymity invariant forbids. Storing "user X used N tokens **this hour**"
(no code) meters the student for future quotas **without** revealing which activity
they did. So `usage_by_code` carries no user and `usage_by_user` carries no code (and
no module) — neither table ever links a student to an activity, even though the
runtime knows the `oid` for anonymous codes (it is only ever stored against an hour
bucket). Trade-off: "student X's usage on code Y" is unanswerable, by design.

Columns: `input_tokens_new` / `input_tokens_cached` / `output_tokens` are `bigint`
token sums (`output_tokens` already includes reasoning tokens); `tool_calls` /
`user_messages` / `quiz_answers` / `writing_saves` are `int` counts. `hour` is the
UTC top-of-hour bucket. No foreign keys (same rule as the other `novedu_*` tables);
never garbage-collected. Migrated by Drizzle at startup like every `novedu_*` table.

## The write seam — `lib/usage-store.ts`

The **only** access to both tables. Mirrors `lib/user-chat-store.ts` discipline: it
**never throws** — errors are logged and routed to `recordError`, then dropped
(a lost increment can never break a chat, a grade, a save, or the coding proxy). All
writes run **off the response path** (the exporter is async; the route/action
counters use `after()`; the coding tap is fire-and-forget).

- `recordLlmUsage({ code, module, userId?, inputNew, inputCached, output, toolCalls, at? })`
  — increments `usage_by_code` always, and `usage_by_user` **only when `userId` is
  present** (absent ⇒ the coding-proxy path, metered per-code only).
- `recordUserMessage` / `recordQuizAnswer` / `recordWritingSave` — `+1` on their
  counter in both tables.

Each write is an **increment-UPSERT**: INSERT the bucket with the deltas as its
initial values; on a duplicate key increment each column in place (the same
INSERT-first / catch-UPDATE idiom as `writing-store`, adapted to add rather than
overwrite, so two concurrent writers on one bucket both land). `module` is required
for the `usage_by_code` INSERT; it is constant per code, so whichever recorder
inserts first sets it.

## Capture points

| Metric(s) | Where | How |
|---|---|---|
| tokens + tool calls — tutor, quiz discussion, writing, quiz grader | Mastra observability exporter | `MODEL_GENERATION` + tool-call spans, attributed via `requestContext` |
| tokens — coding proxy | the coding route | taps the passthrough response for the `usage` chunk; per-code only |
| user messages | CopilotKit route (`run`) | `after()` → `recordUserMessage` |
| quiz answers | `submitAnswer` (`lib/quiz-actions.ts`) | `after()` → `recordQuizAnswer` on a successful grade |
| writing saves | `saveWriting` (`lib/writing-actions.ts`) | `after()` → `recordWritingSave` after a successful save |

Agent attribution rides three RequestContext keys — `usageCode`, `usageUserId`,
`usageModule` (`lib/usage-context-keys.ts`) — set on the per-request RequestContext:
the CopilotKit route sets them on `built.context` before `getLocalAgents`; the quiz
grader sets them on the RequestContext it builds for `submitAnswer`. `usageUserId` is
set for **all** codes including anonymous ones (it only ever reaches `usage_by_user`).

## The observability exporter — `app/mastra/usage-exporter.ts`

A custom `ObservabilityExporter` (from `@mastra/observability`) registered on the
Mastra instance under one config named `usage`, with `default: { enabled: false }` (no
built-in storage/platform exporters) and `requestContextKeys` for the three keys, so
Mastra snapshots them onto every span. This is the **Mastra-native** path because
`@ag-ui/mastra` drops `usage` from the AG-UI event stream, so tapping the outgoing
SSE would miss tokens.

On `span_ended` the pure `mapSpanToUsage`:

- `MODEL_GENERATION`: reads `attributes.usage` — the `UsageStats` shape in
  `@mastra/core@1.47.0`: `inputCached = inputDetails.cacheRead ?? 0`,
  `inputNew = inputTokens − inputCached`, `output = outputTokens`. Uses
  `MODEL_GENERATION` **only** (never `MODEL_STEP`) to avoid double-counting.
- `TOOL_CALL` / `CLIENT_TOOL_CALL` / `MCP_TOOL_CALL`: `+1` tool call, no tokens.

The auto-applied `SensitiveDataFilter` is left on (privacy-safe default); it uses
**exact** field-name matching and processes only `attributes`/`metadata`/`input`/
`output`, so the three attribution keys survive. The exporter reads **ids + counts
only**, never span `input`/`output` (prompt content) — the telemetry no-PII invariant.

## The coding proxy

The coding route (`app/api/coding/v1/chat/completions`) is a non-Mastra passthrough,
so it is metered separately: `buildUpstreamChatBody` sets
`stream_options.include_usage: true` when the client streams (non-streamed responses
already carry `usage`), and the route **tees** the upstream body — one branch to the
client byte-for-byte, the other read in the background to extract the final `usage`
(`extractCodingUsage`) and `recordLlmUsage({ module: "coding" })`. No `oid` on this
path, so it never touches `usage_by_user`; the passthrough (streaming + client tools)
is unchanged.

## Cached input tokens

`input_tokens_cached` counts prefix-cache hits — the model reusing a cached prompt
prefix (a large system prompt + prior turns) instead of re-encoding it, so a busy code
often has far more cached than new input. SCCH's vLLM reports these as
`usage.prompt_tokens_details.cached_tokens`; Mastra surfaces the value as
`usage.inputDetails.cacheRead`, and the exporter records it as `input_tokens_cached`,
with the remainder (`inputTokens − cacheRead`) as `input_tokens_new`. The coding proxy
reads the OpenAI field directly. All input tokens (cached + new) still bill; the split
is for cost visibility.

## Testing

- Unit (hermetic): `hourBucket` truncation and the increment column mapping against a
  mocked executor (`lib/usage-store.unit.test.ts`), the pure span→delta mapping over
  fake spans (`app/mastra/usage-exporter.unit.test.ts`), and the coding usage
  extractor + `include_usage` request shaping (`lib/coding-proxy.unit.test.ts`).
- The real UPSERT / concurrent double-increment is a `@live-db` concern (a real
  SQL Server), consistent with `docs/testing.md`.
