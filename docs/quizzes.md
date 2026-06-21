# Quizzes (MVP)

Deep reference for the **Quizzes** feature: teachers author a quiz in YAML, share
a stateless signed link, and students answer open-ended questions that an LLM
grades (`correct` / `partial` / `incorrect` + markdown feedback). Each question
has an opt-in, **in-page** discussion chat. The always-on invariants are
summarized in `AGENTS.md`; this file has the full mechanics. Design spec:
`docs/superpowers/specs/2026-06-19-quizzes-design.md`.

It is deliberately minimal — its purpose is to demonstrate the concept and gather
teacher feedback, so it favors the smallest correct change over parity with the
mature tutor-code subsystem. **No new database table and no migration.**

Read it before touching `app/q/*`, `app/share-quiz/*`, `app/quizzes/*`,
`lib/quiz-*.ts`, `app/mastra/quiz-agents.ts`, the quiz branch of the CopilotKit
route, or the `kind: "quiz"` paths in the files subsystem.

## Surfaces

| Surface | Path | Who | Notes |
| --- | --- | --- | --- |
| Author | `/files/new` (kind **Quiz**) | teacher | stored in `novedu_files`; NOT structurally validated (stub) |
| Create link | `/share-quiz` (`share-quiz-form.tsx`) | teacher | quiz URL + availability window → signed `/q?…` link; `?quiz=` prefill. A top-level **"Share Quiz"** nav item (`components/nav-menu.tsx`, teacher-only) plus the `/files` quiz-row action both lead here |
| Take quiz | `/q?quiz=&start=&end=&sig=` (`app/q/page.tsx`) | student | static `/q` wins over `/[code]`; verifies the link, then the runner |
| Discussions | `/quizzes/<name>/discussions` | teacher | reuses the tutor-code stats reader keyed by the quiz URL |
| Transcript | `/quizzes/<name>/c/<threadId>` | teacher | reuses the read-only `ConversationView` |

The `/files` list shows a **"Create quiz link"** and a **"Discussions"** action on
quiz rows (mirroring the tutor flow's `/tutor-codes/new?tutor=` shortcut).

## Storage — reuse `novedu_files` with `kind: "quiz"`

A quiz YAML is an app-hosted file under a new **`kind: "quiz"`**
(`lib/file-name.ts`: `FileKind = "tutor" | "fragment" | "quiz"`), so it gets a
public `GET /api/files/<name>` URL with **zero** changes to the file store, the
schema (`kind` is the existing `varchar(16)`), or `proxy.ts`.

- **No quiz validator.** `validateFileContent(kind="quiz")` in
  `lib/files-actions.ts` returns `{ ok: true, title: null, description: null }`
  plus a single non-blocking warning (`QUIZ_VALIDATION_NOT_IMPLEMENTED`): saving
  never blocks and the Validate button passes for any quiz YAML. `title`/`description`
  are stored NULL (like fragments), so the list shows a quiz by name.
- The **only** quiz parsing is a lenient runtime read, `parseQuiz` in
  `lib/quiz-yaml.ts` — a small typed parse (id / model / shuffle / anonymous /
  discussion / questions[{id,title,question,evaluation}]) with a friendly message
  on a missing essential. **NOT** a `lib/tutors`-style Zod gate.

## The quiz YAML format

Demonstrated by `quizzes/sample-quiz.yaml`. Key fields: `id`, `name`, optional
`title`/`description` (student welcome), `anonymous` (default `true`, read LIVE),
`shuffle` (default `true`), `llm.model` (grades AND drives the discussion),
optional `discussion.instructions`, and `questions[]` each with `id`, optional
`title`, `question` (markdown), and `evaluation` (the SERVER-ONLY grading prompt).

- **`evaluation` is never sent to the browser.** `toPublicQuiz` (`lib/quiz-yaml.ts`)
  strips it (and `model`, `anonymous`, `discussion`) before anything reaches the
  client; the student page ships only the `QuizPublic` projection.
- Verdict vocabulary: internal enum `correct | partial | incorrect`
  (`lib/quiz-types.ts`), shown to students via `verdictLabel` as
  **"correct / partly correct / wrong."** `lib/quiz-types.ts` is client-safe (no
  YAML parser, no node:crypto) so the runner imports the types + label without
  pulling the parser into the browser bundle.

## Stateless signed links — `lib/quiz-link.ts`

A near-verbatim revival of the app's original tutor share-link mechanism (removed
when tutor codes landed), keyed for quizzes:

- Payload `{ quiz: URL.href, start, end }` (unix seconds, both bounds inclusive);
  canonical string `quiz=<quiz>&start=<start>&end=<end>` with a digits-only guard
  on start/end (keeps the form injective even when the quiz URL contains `&start=`).
- HMAC-SHA256 hex, constant-time hex compare. **Secret is AUTH_SECRET-derived**
  (`getQuizLinkSecret`, domain `"novedu:quiz-link:v1"`, like `lib/thread-token.ts`)
  — **no new env var** (the old code's `SHARE_LINK_SECRET` is NOT revived).
- `verifyQuizLink` → `{ ok }` or `missing-params | invalid-signature | not-started
  | expired`. Re-verified on **every** server touch: the `/q` page, `submitAnswer`,
  `startDiscussion`, and every runtime quiz request. The `/q` page renders the rich
  `QuizLinkError` view; server actions/route surface `quizLinkRejectionMessage`.
- `createQuizLinkAction` (`lib/quiz-link-actions.ts`, teacher-gated) validates
  http(s) + `end > start` and signs; it does **not** validate the quiz YAML (none
  exists). `/share-quiz` is the teacher form; `lib/datetime-local.ts` converts the
  local-time pickers to unix seconds in the browser.

## Grading — `quizEvaluator` agent + `submitAnswer`

- `submitAnswer` (`lib/quiz-actions.ts`) re-verifies the link, re-loads the quiz
  (`loadQuiz`), finds the question, builds a grading system prompt (frame + the
  question's `evaluation`) onto a `RequestContext`, and runs the **`quizEvaluator`**
  agent with `structuredOutput: { schema: QUIZ_VERDICT_SCHEMA }`. Returns
  `{ result, feedback }`; the `evaluation` prompt never leaves the server.
- **`quizEvaluator`** (`app/mastra/quiz-agents.ts`) is **memory-less** (no `Memory`
  → a `generate()` persists nothing — the "we do NOT record quiz sessions"
  promise) with per-request dynamic `instructions`/`model` off the `RequestContext`,
  resolved through `scchProvider.chat(model)` (same path as the tutor agent). Going
  through Mastra keeps structured output portable to the future multi-provider seam.
- **Structured output is verified to work on the production model.** A live test
  confirmed `RedHatAI/gemma-4-31B-it-FP8-Dynamic` honors OpenAI-compatible
  `response_format: json_schema` (strict), which is exactly what Mastra's
  `structuredOutput` emits — so **no `jsonPromptInjection` fallback is needed**
  (keep it in mind as a safety net if a future model lacks `response_format`).

## Discussion — `quizDiscussion` agent, seeded thread, modal mount

The discussion is **non-negotiably in-page** (never a navigation): clicking "Chat
about this" opens it in a native modal **`<dialog>`** overlaying the `/q` page
(`app/q/quiz-runner.tsx` drives `showModal()`/`close()` from a `discussionOpen`
state; Escape, a Close button, and a backdrop click all close it; closing keeps
the thread so "Continue discussion" can reopen it, and Next / Finish drop it).
`app/q/quiz-discussion.tsx` renders, inside a `CopilotKitProvider` keyed by the
thread id: the **graded feedback** on top, then a live `CopilotChat`
(agentId `"quizDiscussion"`) below.

- **`startDiscussion`** (`lib/quiz-actions.ts`, re-verifies the link) mints a
  `threadId`, signs a **thread-token** `(quizUrl, userId, threadId)`
  (`lib/thread-token.ts`), and persists **three seed messages** into a Mastra
  thread (`resourceId = the quiz URL`) via the discussion agent's memory
  (`createThread` + `saveMessages` with the v2 UIMessage content envelope):
  1. assistant — `Answer the following question: <question>`
  2. user — `<the student's answer>`
  3. assistant — `Your answer is <verdict label>. <feedback>`
  It returns just `{ threadId, threadToken }` — the seed messages stay server-side
  (their `QuizSeedMessage` shape is internal to `lib/quiz-actions.ts`; the client
  never receives them). The modal shows only the graded **feedback** at the top (the
  verdict card is hidden behind the modal, so the chat must show its own context,
  but re-printing the full question + answer would crowd out the live chat). The
  live `CopilotChat` below
  starts visually empty — explicit-threadId `connect` replays only the in-process
  run cache, which is empty for a freshly-minted thread — and the model still
  recalls the full seeded context from memory. A follow-up is the only NEW turn the
  client sends, so `trimToNewTurn` keeps the DB from re-storing the seeds.
- The **runtime route quiz branch** (`app/api/copilotkit/[[...slug]]/route.ts`,
  selected by the `x-quiz-*` headers) re-verifies the link sig + window, verifies
  the thread token against `(quizUrl, userId, threadId)`, re-loads the quiz for the
  `discussion.instructions` + model + live `anonymous` flag, sets `resourceId = the
  quiz URL`, and runs the **`quizDiscussion`** agent with `trimToNewTurn` (only the
  new turn persists; seeds reach the model via memory recall).

## Teacher visibility (reused stats viewer)

The tutor-code stats reader was renamed to neutral names and reused unchanged:
`getCodeStats` / `getConversationMessages` (`lib/tutor-stats-store.ts`) take a
plain key string and read `mastra_threads` / `mastra_messages` filtered by
`resourceId`, with `novedu_user_chats` only a LEFT JOIN for the student id. The
quiz Discussions page keys them by `resourceId = new URL(filePublicUrl(origin,
name)).href` (the same URL.href the signed link carried). A discussion thread
qualifies because its seed contains a `role='user'` message, so it appears even
with no follow-up. Anonymity is enforced at the data layer using the quiz's LIVE
`anonymous` flag.

## Attribution — `recordQuizChat`

For a non-anonymous quiz, the route's quiz branch calls `recordQuizChat`
(`lib/user-chat-store.ts`) after a successful run (off the response path, deduped).
Because `novedu_user_chats.code` is `varchar(10)` (sized for tutor codes) and a
quiz URL won't fit — and the quiz stats query joins by `thread_id` (the `code`
value is incidental) — the stored `code` is a stable short token
`q:<8 hex of sha256(quizUrl)>`. The `q:` prefix contains a `:` that a
`[a-z0-9]{10}` tutor code never has, so a quiz row can never collide with (or be
deleted alongside) a real tutor code. The `anonymous` flag is server-derived by
the route (re-parsed from the YAML), never client-supplied.

## Security & gates

- **Link integrity:** the quiz URL + window are HMAC-signed and re-verified on
  every server touch — a student can't point the runner at an arbitrary YAML or
  stretch the window.
- **Eval prompts never reach the client** — read only inside `submitAnswer` / the
  route (server-side).
- **The grader is never web-reachable.** `quizEvaluator` is registered in Mastra
  but the runtime route RUNS exactly one agent per branch (`tutor` /
  `quizDiscussion`); any other agent id 404s, so `agent/quizEvaluator/*` is dead.
- **Discussion isolation** is the existing thread-token HMAC; the route keeps
  404ing every endpoint the app doesn't use.
- **Teacher-gating:** `/share-quiz`, `createQuizLinkAction`, quiz-file CRUD, and
  the Discussions / transcript pages gate on an *effective* teacher
  (`requireEffectiveTeacher()` / `requireTeacherUserId()` / `requireTeacherPage()`).
- **Auth:** `/q`, `/share-quiz`, `/quizzes/*` and the actions are behind the Entra
  gate like everything else — **no `proxy.ts` change** (only `/api/files` is
  public, and it already is).

## Tests

- Hermetic unit: `lib/quiz-link.unit.test.ts` (sign/verify, tampering, windows,
  AUTH_SECRET-derived secret), `lib/quiz-yaml.unit.test.ts` (lenient parse;
  `evaluation`/model/instructions never in the public projection),
  `lib/quiz-link-actions.unit.test.ts`, the quiz-kind stub in
  `lib/files-actions.unit.test.ts`, the `"quiz"` case in `lib/file-name.unit.test.ts`,
  and the quiz-branch gate in `app/api/copilotkit/[[...slug]]/route.unit.test.ts`
  (real link + thread HMAC; asserts the grader 404s). Component:
  `app/share-quiz/quiz-link-error.unit.test.tsx`.
- e2e: `e2e/auth-gate.spec.ts` (the `/q` + `/share-quiz` gate, hermetic),
  `e2e/files.spec.ts` (the quiz Validate stub, hermetic), and `e2e/quiz.spec.ts`
  (a hermetic tampered-link notice + the `@live`/`@live-llm` author → share →
  answer → discuss flow, local-only).

## Future work (deferred)

A real quiz validator; result/attempt recording for per-question aggregates; a
first-class quiz-code subsystem (table, unguessable codes, frozen `anonymous`) if
the feature graduates; the shared `resolveModel()` provider seam.
