# Codes

Deep reference for how students reach an **activity** — a tutor chat, a quiz, or a
writing activity — and how teachers mint and manage the **codes** that hand them
out. The always-on
invariants are summarized in `AGENTS.md`; this file has the full mechanics. Read
it before touching the entry points (`app/page.tsx`, `app/[code]/**`), the
teacher surfaces (`app/codes/**`), the runtime route
(`app/api/copilotkit/[[...slug]]/route.ts`), the validator/module seams
(`lib/file-validators.ts`, `lib/code-modules/**`), the create pipeline
(`lib/code-service.ts`), or the `novedu_*` stores in `lib/code-*.ts`. The
bearer API channel (`GET`/`POST /api/codes`, `novedu-cli codes`) is documented
in `docs/api.md`.

## The model

A **code** is a `[a-z0-9-]` string (1–32 chars; `generateCode()` mints 10 random
`[a-z0-9]`, 36^10 ≈ 3.6 × 10^15 — unguessable) minted by a teacher on
`/codes/new` and stored as a row in the `novedu_codes` SQL table:

| Column | Meaning |
| --- | --- |
| `code` (PK) | the code, `varchar(32)` (sized for future teacher-defined memorable codes) |
| `module` | the dispatch discriminator — `tutor` \| `quiz` \| `writing` \| `coding`, picks the renderer + agent (the `coding` module has no in-app agent — it is an OpenAI-compatible endpoint; see `docs/coding.md`) |
| `created_by` | session user id (Entra `oid`) of the creating teacher |
| `file_url` | public URL of the activity YAML (normalized via `URL.href`) |
| `valid_from` / `valid_until` | availability window, UTC `datetime2`, **both bounds inclusive**. Each is **nullable** — a null `valid_from` opens the code immediately, a null `valid_until` never expires it (both null = always valid). `checkCode` / `windowStatus` coalesce a null bound to `DISTANT_PAST` / `DISTANT_FUTURE` |
| `note` | teacher's label, shown in their code list and as the recents label (≤ 200 chars) |
| `origin` | **documentation-only**: where the code was created (DEV vs PROD rows). Lookups never read it — a code created on localhost works in production, since all environments share the database |
| `anonymous` | the activity YAML's `anonymous` flag (default is module-specific — tutor/quiz `true`, writing `false`, coding always `true`), **frozen at create time** — a later YAML edit does NOT update it. Governs whether the stats page shows per-student data |
| `llm_provider` / `llm_model` | the code's optional **LLM override pair**: when set, they replace the activity YAML's `llm.provider`/`llm.model` for every request served under this code. **Both-or-nothing** — either both NULL (the YAML's `llm:` block applies) or both set; model ids are provider-specific, so validation rejects a lone half. Surfaced as `CodeEntry.llm` and applied via `effectiveLlm` (`lib/code-store.ts`); a corrupt stored pair is logged and read as no override. Editable on `/codes/edit` (NOT frozen) |
| `created_at` | creation time |

Indexes: PK on `code`; `created_by` (the teacher list); `module` (the
module-filtered list).

**The stored row is the security boundary.** There is no signature and no
stateless link form: an activity opens if (and only while) a row with that code
exists and "now" is inside its window. The single check lives in `checkCode()`
(`lib/code-store.ts`) and is used by every gate (the student entry route, the
runtime route, and the quiz actions), each re-checking on **every** server touch
— one PK SELECT on the pooled connection — so an open activity stops accepting
input the moment its window closes (403 / error with a human-readable reason).
Malformed codes are pattern-rejected without a database round-trip — which also
gives every unknown single-segment URL (`/whatever`) a clean "unknown code" page,
since `app/[code]` catches all non-static top-level paths.

## Three layers: FileKind → validator → CodeModule

The subsystem is cleanly split so a new activity (or a pure library kind) slots
in without touching the core.

**Layer 1 — `FileKind`** (`lib/file-name.ts`): `tutor | fragment | quiz | writing | coding`.
Drives the `/files` editor kind selector and `novedu_files.kind`.

**Layer 2 — the validator registry** (`lib/file-validators.ts`):
`fileValidators[kind].validate(url, fetcher) → { ok, errors?, warnings, title?,
description?, anonymous? }` is the **single source of truth** for "is this YAML
valid, and what metadata does it carry." It is consumed by `/files` save + the
standalone **Validate** button (fetcher resolves the editor buffer + app-hosted
siblings) AND by code-create (fetcher = `appHostedFetcher`; url = the row's
`file_url`).

- `tutor` → the THOROUGH gate (`loadAndBuildTutorPrompt`, `validateLibraries:
  true`): every fragment in every referenced library is strict-rendered, surfacing
  `title`/`description`/`anonymous`.
- `fragment` → `loadAndCheckFragmentFile`: a real validator with **no module** —
  the canonical "validator without a module." A future pure library kind likewise
  adds only a validator entry.
- `quiz` → `loadAndCheckQuiz` (`lib/quiz-validate.ts`): a strict authoring gate —
  the `QuizYamlSchema` Zod check plus a duplicate-question-id pass — that **blocks**
  an invalid save and surfaces `anonymous`/`title`. The lenient runtime `parseQuiz`
  (`lib/quiz-yaml.ts`) is a separate, deliberately permissive read for the student
  path. The same validator backs `/files` save, code-create, and the
  `novedu-cli validate --kind quiz` command.
- `writing` → `loadAndCheckWriting` (`lib/writing-validate.ts`): the same kind of
  strict `WritingYamlSchema` gate, differing only in that writing defaults
  `anonymous: false` — see `docs/writing.md`.
- `coding` → `loadAndCheckCoding` (`lib/coding-validate.ts`): the same kind of strict
  `CodingYamlSchema` gate (bad YAML, missing field, no `llm.model`, no `instructions`
  → blocks the save), differing only in that it carries **no** anonymity flag — coding
  is always anonymous, so the seam freezes `anonymous: true` (the schema has no
  `anonymous` field to read). The lenient runtime read is `parseCoding`
  (`lib/coding-yaml.ts`) — see `docs/coding.md`.

**Layer 3 — the `CodeModule` registry** (`lib/code-modules/`): the registry of
shareable activities.

- `types.ts` is **client-safe** (`CodeModule = "tutor" | "quiz" | "writing" |
  "coding"` + display labels) so client components and the `/codes` module filter
  can name modules without importing server code.
- `registry.ts` is **server-only** (`codeModules: Record<CodeModule,
  CodeModuleDef>`). Each descriptor carries a `fileKind` (which Layer-2 validator
  to reuse) and only what is genuinely activity-specific:
  - Create-time validation is **not** a descriptor field — it is derived from
    `fileKind` by `validateCodeFile(module, fileUrl, fetcher)` (literally
    `fileValidators[fileKind].validate`), so a module never redefines validation and
    can't wire the wrong validator.
  - `runtime` — `{ agentId, buildRequestContext(entry) }`: which Mastra agent the
    runtime route runs and how its per-request `RequestContext` (system prompt +
    model) is built. **Optional**: `coding` omits it (it has no in-app agent), and
    the CopilotKit route 404s any module without a `runtime`.
  - `renderDetail(entry, searchParams)` — **the** teacher detail body on
    `/codes/[code]`. Each module owns it entirely; there is no privileged "stats
    shell" a module overrides. tutor/quiz share the `ConversationStats` component by
    calling it; writing renders its savers list; coding shows its config + connection
    details. Descriptors call these server components as **plain functions**
    (returning `ReactNode`), so no JSX lives in the server-only registry.
  - `renderResult?(entry, { shareUrl, origin })` — **optional** override of the
    create/edit screen's result body (server-rendered on `/codes/edit/[code]`, handed
    to the client `CodeForm` as a slot), dispatched + defaulted by
    `renderCodeResult(entry, ctx)`. Omitted, it defaults to **`ShareLinkResult`** (the
    `/<code>` share link with a copy button — tutor/quiz/writing all use the default);
    `coding` is the lone override, showing its little-coder connection config
    (`CodingResult` → `CodingConnection`) — a coding code is an API key, not a web
    link. Same plain-function pattern as `renderDetail`.
- `tutor.ts`, `quiz.ts`, `writing.ts`, `coding.ts` are the descriptors. `writing` is
  the Markdown-writing-with-AI-feedback module (`docs/writing.md`): its `renderDetail`
  is the savers-first teacher review (saved text first, chat second), and its agent
  reads the student's live draft through the read-only `getCurrentText` frontend tool
  but has no tool to change it. `coding` is the OpenAI-compatible coding-endpoint
  module (`docs/coding.md`): it has **no `runtime`** and is reached only through its
  own public `/api/coding/v1` route, with the code as the bearer API key.

Student **rendering** is also NOT a registry seam: it is a thin `switch (entry.module)`
in `app/[code]/page.tsx` delegating to each module's own server component
(`render-tutor.tsx`, `render-quiz.tsx`, `render-writing.tsx`). (The *teacher* detail
body IS a registry seam — `renderDetail` above — but descriptors keep JSX out by
calling components as plain functions.)

**Adding a module** touches a small, fixed set of seams: a descriptor file (with its
`renderDetail`, plus a `renderResult` only if it overrides the share-link default) + one
`codeModules` line, a client label (`lib/code-modules/types.ts`),
a student render case (the thin `switch` in `app/[code]/page.tsx`) with its own render
component + agent, and — for a **new file kind** — that kind's validator and
`readAnonymousFlag` branch in the FileKind layer (`lib/file-validators.ts`). Create
validation (from `fileKind`) and the share-link result (the default) come for free. The
**generic flow** never changes: the code store, the runtime route, and attribution all
dispatch by `module`/`fileKind`. **Adding a pure library kind** = one Layer-2
validator entry, no module; the `fragment` kind proves the asymmetry is real.

## Student entry & runtime dispatch

`app/[code]/page.tsx` is a thin **dispatcher** (server component):

1. `checkCode(code)` → on failure render `app/code-error.tsx` (`unknown-code` /
   `not-started` / `expired` / `lookup-failed`, with the window bounds in local
   time where known).
2. record/clean up the user's recent codes (off the response path).
3. mint a server-side `threadId` and sign the thread-ownership token `(code,
   userId, threadId)`.
4. `switch (entry.module)` → delegate to the module's render component, which
   loads the activity YAML (uncached, so edits show immediately) and renders the
   surface (`<TutorChat>` / `<QuizRunner>`).

The chat **runtime route** (`app/api/copilotkit/[[...slug]]/route.ts`) uses ONE
header scheme: **`x-code`** (+ `x-thread-token`; headers, not a query string,
because CopilotKit appends sub-paths like `/info` to the runtime URL). It
`checkCode`s the header, reads `module` off the row, looks up
`codeModules[module].runtime` to pick the agent id and build the
`RequestContext`, and runs that one agent. `resourceId` is the **code** for every
module. One access check, one header scheme, module-driven agent selection.

Every consumption of the activity's `llm.provider`/`llm.model` goes through
`effectiveLlm(entry, activityLlm)` (`lib/code-store.ts`): the code's LLM override
pair wins wholesale when set. The five sites: the tutor agent (the descriptor
puts the pair on the RequestContext as `tutor-provider-override`/
`tutor-model-override`; `app/mastra/tutor-agent.ts` applies it), the quiz
discussion + writing `buildRequestContext`s, the quiz grader (`submitAnswer`),
and the coding proxy. Each gates `providerUnavailableReason` on the EFFECTIVE
provider. Usage metering needs no extra wiring — the exporter reads the actually
resolved provider/model off the MODEL_GENERATION span (`docs/ai-models.md`), and
the coding proxy meters the effective pair explicitly.

The runtime route additionally enforces **thread ownership**: every
thread-touching request (`agent/{id}/run`, `agent/{id}/connect`,
`agent/{id}/stop/{threadId}`) must carry an `x-thread-token` whose HMAC-SHA256
over `(code, userId, threadId)` (key derived from `AUTH_SECRET`,
`lib/thread-token.ts`) matches the **session user**, so a leaked threadId (even
with its token) is useless to anyone else. This is the ONLY thread isolation
there is — Mastra fetches threads by id without checking the resourceId — and it
is stateless on purpose; an ownership table would break the anonymity promise
below. All runtime endpoints the app does not use (`/threads/*`, `/transcribe`,
…) return 404.

## URLs & entry page

- An activity lives at **`/<code>`** — no query parameters. Teachers hand out
  `https://<host>/<code>`; the code alone also works.
- **`/`** is the entry page (`app/code-entry.tsx`): a form that accepts a bare
  code or a pasted full URL (the client extracts the last path segment;
  format-only validation against `[a-z0-9-]{1,32}`), plus the user's **recently
  used codes** as one-click shortcuts.
- Recents live in SQL (`novedu_recent_codes`, PK `user_id` + `code`,
  `last_used`), recorded server-side after every successful open and capped at the
  newest 10 per user. The entry page lists them via an inner join with
  `novedu_codes` (label = `note`, fallback code) — so codes whose row was deleted
  disappear by themselves. Clicking a recent code that turns out dead
  (`unknown-code` / `expired`) removes the row server-side; `not-started` and
  transient `lookup-failed` keep it.

## Creating & editing codes

`/codes/new` ("New code", teacher-only via `requireTeacherPage()` on the page +
`requireTeacherUserId()` in the action; reached from the "New code" button on
`/codes`, or with `?module=<kind>&file=<url>` pre-filled from the YAML Files
"Create code" shortcut — `/share-tutor` and `/share-quiz` both 308-redirect
here): a **module** selector + the file URL + optional note + window as
`datetime-local` (converted to unix seconds IN THE BROWSER — the only place the
teacher's timezone is known) + the optional **LLM override** (below). **Either
window field may be left blank** for an
open-ended code (no start / no end → a null bound). The create pipeline lives in
**`lib/code-service.ts`** (`createCodeForUser` — a plain server module that takes
the verified `userId`; auth never enters it): it validates the input, gates an
LLM override's provider, then runs `validateCodeFile(module, …)` (the Layer-2
validator for the module's `fileKind`), **freezes** `anonymous`/`title` from the
result, and inserts the row. TWO thin channel shells call it with identical
semantics: the web form's `createCodeAction` (`lib/code-actions.ts`,
`requireTeacherUserId` + FormData + redirect) and the bearer
`POST /api/codes` (`requireBearerTeacher` + JSON — `docs/api.md`).

The **LLM override** section is two free-text fields (provider + model) plus
preset buttons (`LLM_OVERRIDE_PRESETS`, `lib/llm/presets.ts` — the built-in
SCCH/Gemma-4 and Azure-Foundry/gpt-5.4-mini fills; a Clear button empties both).
Left blank, the code serves the activity YAML's `llm:` values. Filled, the pair
replaces provider AND model for every request under the code (both-or-nothing:
the server rejects a half-filled pair or an unknown provider, and gates the
override's provider through `providerUnavailableReason` at save time so a
Foundry override cannot be stored on an SCCH-only server). The override swaps
ONLY the LLM — the system prompt, `anonymous`, and everything else still come
from the YAML (a tutor YAML's `llm.imageInput` still gates the attachment UI, so
pick a vision-capable override model for a vision tutor). **A storage failure is a
hard error** — without a row there is nothing to hand out. On success the action
**redirects to `/codes/edit/<code>`**, which shows the module's **result body** via
`renderCodeResult`: the default `/<code>` share link (copy button) for
tutor/quiz/writing, coding its little-coder connection config. The origin comes from `CODE_ORIGIN` (read
first), then `TUTOR_CODE_ORIGIN` (fallback), then the request's forwarded/host headers
(fine for dev); it is display-only.

**Editing** (`/codes/edit/[code]`, the SAME `CodeForm` in `mode="edit"` →
`updateCodeAction` → `updateCode`) changes only the **note**, the
**availability window**, and the **LLM override pair** (set or cleared as a
whole, same validation + availability gate as create). The module and the file
URL are shown **read-only** and
are never submitted, so the frozen `anonymous` flag (which the file implies) stays
valid and no YAML re-validation is needed.

`/codes` ("Codes", teacher-only) lists **ALL** codes across modules — any
effective teacher may see and manage every code (RBAC planned) — via `listCodes({
search, createdBy, module })`, newest first, active + not-yet-started (`upcoming`
badge) + already-expired (`expired` badge), since codes are not garbage-collected.
Filtering (a text contains-match over note/code, an "Only my codes" toggle, and a
**module** `<select>`) happens **in the database** through URL search params,
never in memory — the shared filtered-list concept (`docs/filtered-lists.md`).
Each row: a **Module** badge, note (fallback code, `file_url` tooltip), window in
local time (an open bound shows as **"No start"** / **"No end"**), an
**interaction** count (qualifying Mastra threads under
`resourceId = code` — `getInteractionCounts`, ONE aggregate query for the whole
filtered set, no per-row query), a stats link, an Open link (active codes only), a
Copy button, and an **Edit** link. Deletion is the list's **"Delete Selected"**
multi-delete (tick the rows, confirm; it wipes each selected code and all of its
conversation data — see Lifecycle and `docs/filtered-lists.md`).

## Chats, memory & the join model

The Mastra memory **`resourceId` is the code** (set in the runtime route), and
`threadId` is a per-chat UUID generated **server-side per page load**, pinned into
the CopilotKit client via CopilotChat's `threadId` prop (explicit mode — the shared
`ModuleChat` primitive owns this frontend wiring; see `docs/chat.md` for why the
prop, not the configuration provider) and proven back to the runtime by the
`x-thread-token` ownership token (nothing is persisted client-side — a reload starts
a fresh thread). Relationships across the
Drizzle- and Mastra-owned tables are **by value — never foreign keys**
(`docs/database.md`):

```
novedu_codes.code        = novedu_user_chats.code = mastra_threads.resourceId
novedu_user_chats.thread_id = mastra_threads.id   = mastra_messages.thread_id
novedu_user_chats.user_id   = Entra oid (the student)
novedu_codes.created_by     = Entra oid (the teacher)
```

- **All chats/discussions for a code**: `SELECT * FROM mastra_threads WHERE
  resourceId = '<code>'`.
- **user → userchat → history**: filter `novedu_user_chats` by `user_id`, join
  `mastra_threads`/`mastra_messages` via `thread_id`.

`novedu_user_chats` is the ONLY place tying users to chats, and it is
privacy-gated by the activity YAML's **`anonymous` flag, whose default is
module-specific** (tutor/quiz default `true`; **writing defaults `false`** —
`docs/writing.md`): when anonymous, nothing is written — chats cannot be attributed
to a student. Only an activity with `anonymous: false` records `(thread_id, code,
user_id)`; `recordUserChat` (`lib/user-chat-store.ts`, called from the runtime route
off the response path via `after()` — only after a token-verified run got a 2xx —
deduped per thread) reads the flag **live** from the YAML behind the stored
`file_url`, dispatching by the code's file kind (tutor → `loadAndBuildTutorPrompt`,
quiz → `loadQuiz`, writing → `loadWriting`, via `readAnonymousFlag`). It is
privacy-safe on a YAML load failure, which is retried rather than cached. The per-user `novedu_recent_codes` shortcuts are deliberately
separate — they say "this user opened this code", never which chat is theirs.

Note two SEPARATE reads of the same `anonymous` flag. The RUNTIME attribution path
above always reads it **live** from the YAML (so toggling an activity to
`anonymous: false` starts attributing immediately). The STATS page instead reads
the copy **frozen onto `novedu_codes.anonymous` at create time** — it only decides
whether to surface per-student numbers, and freezing keeps that decision stable
for a code's lifetime even if the YAML changes later.

Caveat: with `resourceId = code`, any *resource-scoped* Mastra memory (working
memory, semantic recall) would be shared across all students using the same code.
Today only per-thread `lastMessages` is configured — keep it that way or re-think
the scoping first.

**Only the new turn is persisted per run.** CopilotKit/AG-UI re-sends the ENTIRE
client-side history on every run, and Mastra persists whatever messages it is
handed (each with a fresh id) — so forwarding the whole history re-stores every
prior turn again, ballooning a conversation quadratically (`@mastra/memory`'s own
docs warn against this). The runtime route therefore trims each `run` body to the
turn AFTER the last assistant reply (`trimToNewTurn`) before forwarding it; prior
turns are already stored, so Mastra appends only the new user message + its reply.
The flip side: the model's whole view of the conversation is then the recalled
`lastMessages` window (currently **40** ≈ 20 exchanges, in `tutor-agent.ts` /
`quiz-agents.ts`) — raise it if longer sessions must see further back.
Conversations recorded without this trimming hold telescoped duplicates; the
viewer collapses them on read (see below).

## Stats & conversation viewer

Teacher-only, under the `/codes` prefix (so the root `/[code]` student catch-all
never collides). Both pages are **role-gated, not owner-gated**:
`requireTeacherPage()` + `getCode(code)` (no `created_by` check) — any effective
teacher may read ANY code's stats/conversations (a larger RBAC feature is
planned). This is NOT the thread-ownership token, which remains the student-side
isolation and is unaffected.

- **`/codes/[code]`** — a thin **dispatcher**: it gates, loads `getCode(code)`,
  renders the shared chrome (back-link + which code + an "LLM override:
  provider · model" line when the code carries one; the coding detail
  additionally shows the EFFECTIVE pinned model), then hands the body to
  `codeModules[entry.module].renderDetail(entry, searchParams)`. Each module owns its
  detail. tutor/quiz render the shared **`ConversationStats`** component
  (`getCodeStats(code, anonymous)`): the interaction count (labelled per module —
  "Conversations" for tutor, "Discussions" for quiz), and for non-anonymous codes
  (the frozen `anonymous` flag) the number of distinct students; then a table of every
  interaction (first/last message time, the student when recorded, user-message count),
  each row linking to the viewer. The student is shown by **display name** —
  `getCodeStats` LEFT-JOINs `novedu_users` and the cell falls back to the raw `oid`
  (kept as the hover `title`) when no name is recorded yet (see `docs/auth.md`).
  "Interaction" = a Mastra thread with ≥ 1 `role = 'user'` message (opened-but-silent
  threads do not count). **Writing** renders its savers list instead
  (`docs/writing.md`), or falls back to `ConversationStats` when anonymous. Anonymity
  is enforced **at the data layer**: `ConversationStats` passes the code's frozen
  `anonymous` flag into `getCodeStats`, which for an anonymous code forces every
  `userId` **and resolved name** to `null` and `studentCount` to `0` *before
  returning* — so it cannot surface who a student is even if `novedu_user_chats` holds
  rows (the
  documented case where the YAML was toggled to non-anonymous AFTER the code was
  minted). The `!anonymous` rendering checks are belt-and-braces on top of that.
- **`/codes/[code]/s/[userId]`** — the writing module's per-student reading page (one
  student's saved text + their conversations in a lightbox); see `docs/writing.md`.
- **`/codes/[code]/c/[threadId]`** — a READ-ONLY transcript. The server loads the
  messages (`getConversationMessages`, which re-checks the thread's `resourceId =
  code`) and converts each stored Mastra message to an AG-UI `Message` (text
  rebuilt from `parts`; `file` parts become inline images). It then **collapses
  any replayed history** (`collapseReplayedRuns`): conversations that stored the
  full replayed history as telescoping runs `R1 ⊂ R2 ⊂ … ⊂ Rk` would otherwise
  show each turn many times; a run is dropped only when it is an exact element-wise
  prefix of the next, so a clean conversation passes through untouched. The client
  (`ConversationView`) renders them read-only with no agent ever run or connected —
  the frontend rendering (the shared message components, the agent-less provider)
  is `docs/chat.md`. Its `CopilotKitProvider` still pings `/api/copilotkit/info`
  once on mount; that ping succeeds (200) because the runtime route serves **`/info`
  as auth-only metadata** — the agent registry + capabilities, no chat data, gated by
  authentication ALONE — even though the viewer sends no `x-code` header. The DATA
  endpoints (`run`/`connect`/`stop`) stay gated by the code AND the thread-ownership
  token. Keep this split in mind when touching the runtime route.

Privacy note: this lets a teacher read the *content* of conversations under their
codes. By design that is allowed — `anonymous` only hides *who* a student is
(the user id), never the message text; the thread-ownership HMAC remains the
student-side isolation and is unaffected.

## Quizzes (the `quiz` module)

A quiz is a code with `module: "quiz"`; its `file_url` points at a `novedu_files`
row of `kind: "quiz"`. Teachers author the quiz YAML on `/files/new` (kind
**Quiz**) — stored with **zero** schema change — and mint a quiz code on
`/codes/new` (module **Quiz**, the file pre-filled from the `/files` "Create code"
shortcut). Students reach it at `/<code>` like any other activity; the runner +
in-page discussion live in `app/[code]/_quiz/`.

- **Quiz YAML** (sample: `activities/examples/sorting-algorithms/sorting-quiz.yaml`, parsed leniently by `parseQuiz` in
  `lib/quiz-yaml.ts`): `id`, `name`, optional `title`/`description` (student
  welcome), `anonymous` (default `true`), `shuffle` (default `true`), `llm.model`
  (grades AND drives the discussion) with optional `llm.provider` (missing ⇒ SCCH;
  every module's YAML has it — docs/ai-models.md) and optional `llm.imageInput`
  (photo answers, below), optional `discussion.instructions`, and
  `questions[]` each with `id`, optional `title`, `question` (markdown), an
  optional content `image` (below), an optional `imageInput` override, and
  `evaluation` (the SERVER-ONLY grading prompt).
- **An optional question `image`** is an
  `ImageRef` from the **image subsystem** (`docs/images.md`) — it carries no
  secret (unlike `evaluation`), so it survives `toPublicQuiz` and is resolved
  server-side (`resolveImageRef`) to a `ResolvedImage` rendered above the question
  markdown by `<ContentImage>`. Its `src` resolves in **three cases**: a hosted
  image **name** (`hosted: true` → looked up in `novedu_images`, minted to a
  short-lived read SAS), an **absolute** `http(s)` URL (used as-is), or a path
  **relative** to the quiz's own `file_url`. An optional **`credit`** ("Content
  Credentials") is shown small below the image — for a hosted image it defaults to
  the credit set at upload, and a per-question `credit` overrides it. Example:

  ```yaml
  questions:
    - id: compass-rose
      image:
        hosted: true            # look src up by NAME in the app-hosted image store
        src: sample-compass-rose
        alt: A compass rose showing the four cardinal directions.
        credit: Compass rose — CC BY 4.0   # optional, shown small below the image
      question: |
        Which direction is at the top of a standard map?
      evaluation: |
        North is at the top. …   # SERVER-ONLY, never reaches the browser
  ```
- **Photo answers (`imageInput`)** — students may attach photos (e.g. a
  handwritten derivation) to an answer. Two-level gate: quiz-level
  **`llm.imageInput`** (default `false`, same name/placement as the tutor's
  flag) sets the default; a per-question **`imageInput`** overrides it. The
  effective flag is resolved server-side into the public projection
  (`toPublicQuiz` → `QuizQuestionPublic.imageInput`) and **re-derived on every
  server action** — the client copy is never trusted. Limits live in the shared
  client-safe **`lib/answer-images.ts`** (5 MB per image, ≤ 3 per answer,
  `image/*` — the tutor imports the same constants): the runner validates picks
  client-side (`readAnswerImage`), both quiz actions re-validate server-side
  (`validateAnswerImages`, images rejected outright when the effective flag is
  false). Transport is **base64 data URLs through the existing server actions**
  (no blob storage, no downscaling) — `next.config.ts` raises the global
  server-action `bodySizeLimit` to 25 MB for the 3×5 MB base64-inflated worst
  case. **Image-only answers are allowed** (Submit gates on trimmed text OR ≥ 1
  photo). Grading sends ONE multimodal user message (text part + one image part
  per photo) to `quizEvaluator`; nothing is persisted — the photos are discarded
  after grading. `startDiscussion` seeds the same photos as stored **`file`
  parts** (data URL in `data`) on the student-answer seed, so the discussion
  agent recalls them from memory and the read-only transcript viewer
  (`lib/conversation-collapse.ts`) renders them with zero changes — a teacher
  sees the photo by design (`anonymous` hides *who*, never *what*). Caveat
  (documented, not enforced — same as tutor): a code's LLM override on an
  image-input quiz must be a **vision-capable** model. Covered hermetically in
  `lib/quiz-actions.unit.test.ts` + `tests/component/quiz-runner.browser.test.tsx`;
  the real vision round-trip is `e2e/quiz-image.spec.ts` (`@live-llm`,
  CI-excluded).
- **`evaluation` never reaches the browser.** `toPublicQuiz` strips it (and
  `model`, `anonymous`, `discussion`) before anything reaches the client; the
  runner ships only the `QuizPublic` projection. Verdict vocabulary is the internal
  enum `correct | partial | incorrect` (`lib/quiz-types.ts`, client-safe), shown to
  students via `verdictLabel` as **"correct / partly correct / wrong."**
- **Grading** runs the memory-less **`quizEvaluator`** agent
  (`app/mastra/quiz-agents.ts`): `submitAnswer` (`lib/quiz-actions.ts`) verifies
  the **code** (`checkCode`), re-loads the quiz, finds the question, builds the
  grading prompt (frame + the question's `evaluation`) onto a `RequestContext`, and
  runs the agent with `structuredOutput: { schema: QUIZ_VERDICT_SCHEMA }`. No
  `Memory` → a `generate()` persists nothing. **The grader is never web-reachable**
  — it is not any module's `runtime.agentId`, so `agent/quizEvaluator/*` 404s on
  the runtime route; only `submitAnswer` calls it.
- **Discussion** is **non-negotiably in-page**: clicking "Chat about this" opens a
  native modal `<dialog>` over the page (`quiz-runner.tsx` drives
  `showModal()`/`close()`; Escape, a Close button, and a backdrop click all close
  it; closing keeps the thread so "Continue discussion" reopens it, and Next /
  Finish drop it). `startDiscussion` (`lib/quiz-actions.ts`, verifies the code)
  mints a `threadId`, signs the thread-token `(code, userId, threadId)`, and
  persists **three seed messages** (question / answer / verdict+feedback) into a
  Mastra thread (`resourceId = the code`) via the discussion agent's memory; it
  returns only `{ threadId, threadToken }`. The modal shows the graded **feedback**
  on top, then a live `CopilotChat` (agentId `"quizDiscussion"`) that starts
  visually empty (explicit-threadId `connect` replays only the in-process run
  cache) while the model recalls the full seeded context from memory. A follow-up
  is the only NEW turn, so `trimToNewTurn` keeps the DB from re-storing the seeds.

## Lifecycle

- Codes are **not** garbage-collected. A code and all of its conversation data
  persist until a teacher deletes it on `/codes` via **"Delete Selected"** — the
  only delete path (`deleteCodesAndData`): for each selected code, the Mastra
  threads/messages via Mastra's own `deleteThread`, then the `novedu_*` rows batched
  in one Drizzle transaction with the Mastra deletes per code outside it (the shared
  multi-delete layer — `docs/filtered-lists.md`; see also `docs/database.md`). An
  expired code stays listed: its activity no longer opens (`checkCode`), but its
  stats remain reachable until it is deleted.
- Drizzle migrations apply at startup — see `docs/database.md`.

## Testing

The overall approach (layers, the `@live` boundary, the no-infra patterns) is in
**`docs/testing.md`**. Code-specifics:

- `e2e/code.utils.ts` mints codes (`mintCode({ module, file, … })`, plus a
  `mintTutorCode` wrapper) by inserting rows directly into `novedu_codes` (loads
  `.env` like Next does), so any browser spec that mints or resolves a code needs
  the live database and is tagged `@live` (local only).
- The security-critical paths run in CI with **no** DB, because the gate
  short-circuits before any runtime is built: the runtime gate
  (`app/api/copilotkit/[[...slug]]/route.unit.test.ts`, real thread-token HMAC,
  asserts module dispatch + that the grader 404s), the dispatcher's consumption of
  `checkCode` (`app/[code]/page.unit.test.tsx`) and the tutor render
  (`render-tutor.unit.test.tsx`), the Layer-2 validator seam and the Layer-3
  module dispatch, plus the rejection/error UI
  (`tests/component/code-error.browser.test.tsx`) and the window/pattern logic
  itself (`lib/code-store.unit.test.ts`).
- The **LLM override** is covered in CI end to end across its seams: validation +
  persistence + `effectiveLlm` (`lib/code-store.unit.test.ts`), the save-time
  availability gate (`lib/code-service.unit.test.ts`), each apply point (the
  module descriptor tests, `app/mastra/tutor-agent.unit.test.ts`,
  `lib/quiz-actions.unit.test.ts`, the coding route test), and the form round-trip
  in the `@live-db` CRUD spec (preset fill → stored → shown → cleared).
- The `@live-llm` flows (the tutor chat, the quiz answer→discuss flow, and the
  writing feedback flow **through codes**) live in `e2e/quiz.spec.ts` /
  `e2e/tutor-chat-reply.spec.ts` / `e2e/writing.spec.ts`, local-only.

## Future work (deferred)

- **Custom/memorable codes** (the `code` column + the centralized code seam in
  `lib/code-store.ts` are already sized for them).
- A **real quiz validator** (the Layer-2 stub becomes a one-spot change).
- Result/attempt recording for per-question aggregates; finer-grained RBAC.
