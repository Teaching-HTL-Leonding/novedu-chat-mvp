# `novedu-cli eval` — evaluating a quiz grader against golden answers

A quiz's `evaluation` prompt is a **rubric**, and a rubric is only as good as its
behavior on real answers. `eval` makes that measurable: a teacher writes an **eval
file** — student answers with the verdict each one *must* get — and the CLI replays
them through the **real grading path**, then reports what the grader actually did.

```
novedu-cli eval <evalPathOrUrl...> [--server <url>] [--concurrency <n>=4]
                [--repeats <n>=1] [--llm-provider <p> --llm-model <m>]
                [--json] [--out <file>] [--report <file.md>]
```

Unlike `validate` and `prompts`, this one **runs the model**, so it is teacher-only
and needs a signed-in CLI (`novedu-cli login`). Everything else — reading the eval,
resolving the quiz, assembling every grading prompt — happens **locally**, which is
why an eval works on an unpushed working copy.

Read this before touching `lib/eval-schema.ts`, `lib/eval-validate.ts`,
`cli/src/eval-run.ts`, `cli/src/report-md.ts`, `cli/src/retry.ts`, `app/api/eval/**`, or
the fake grader in `test-fixtures/serve.mjs`.

## The eval file

Strict schema (`lib/eval-schema.ts`), editor schema generated to
`activities/evals/eval-yaml.schema.json` by `npm run generate:schemas`:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/activities/evals/eval-yaml.schema.json
id: welcome-quiz-eval
target: ./0010-welcome-quiz.yaml   # relative to THIS file, or an http(s) URL
questions:
  - question: what-is-a-type       # the quiz's question id
    answers:
      - expect: correct
        answer: |
          A type describes which values a variable may hold.
      - expect: [partial, incorrect]   # more than one grading is defensible
        answer: |
          Something about variables.
```

- **`expect`** is one verdict or a non-empty LIST of acceptable ones. The three
  literals are not restated here — they are **derived from the grader's own
  `QUIZ_VERDICT_SCHEMA`** (`lib/quiz-verdict-schema.ts`), so the format can never
  drift from what the grader can answer.
- **`question`** must name a question of the RESOLVED pool. For a question imported
  through `quiz_files` that is the namespaced `"<alias>/<id>"` id (the same ids
  `novedu-cli prompts --kind quiz` prints).
- Golden answers are **teacher-authored synthetic data** — nothing a student ever
  wrote is involved, and nothing is stored anywhere.
- Text only: a question with `imageInput` can be evaluated on its typed answers, but
  photo cases are out of scope for v1.

Check a file without spending a single token:

```bash
novedu-cli validate ./welcome-quiz.eval.yaml --kind eval
```

`--kind eval` also runs the **strict quiz check** (`loadAndCheckQuiz`, the same one
`--kind quiz` runs) on the resolved target — so validating an eval never asserts less
about the quiz than validating the quiz would. The `eval` command itself deliberately
uses the LENIENT runtime load: what the grader really receives is the whole point
there (the same split `docs/cli-prompts.md` describes).

## Architecture: local fan-out, stateless server

```
CLI (teacher)                          Server (stateless)
─────────────────────────────────      ─────────────────────────────────────
loadAndCheckEval()                     POST /api/eval/grade
  parse + schema + target resolve        requireBearerTeacher
  dumpPrompts("quiz", target)            zod body + provider availability gate
    → the app's OWN grading prompts      answer.trim() → buildAnswerMessage()
for each case × repeats                  quizEvaluator.generate({ structuredOutput })
  (bounded concurrency, default 4)  ──►  200 { result, feedback, usage? }
  retry 4× linear backoff on 5xx
  live progress on stderr                nothing queued, nothing persisted
report: mismatches, totals,
  confusion matrix, false-correct rate
```

**One HTTP request grades exactly one golden answer** (~5–30 s, the duration of a
real student submission). There is no queue, no job, no worker and no run history:
nothing to time out, and a dropped case is simply retried. The CLI owns the fan-out.

### The endpoint

`POST /api/eval/grade` (`app/api/eval/grade/route.ts`, wire contract in
`docs/api.md`) takes `{ llm: { provider?, model }, system, answer }` and answers
`{ result, feedback, usage? }`. The **optional** `usage: { input, cachedInput, output }`
is derived from the generate result — Mastra's `totalUsage` (falling back to the last
step's `usage`), whose AI-SDK v5 field names are `inputTokens` / `outputTokens` /
`cachedInputTokens`. `input` is the total input **including** the cached part;
`cachedInput` is that cache-read part (`0` when the provider does not report it). A
result carrying no usage at all OMITS the field entirely — a missing measurement must
never read as "zero tokens". It runs the **identical** production grading path
`submitAnswer` runs: the memory-less `quizEvaluator` agent, `QUIZ_VERDICT_SCHEMA`
structured output, and `buildAnswerMessage` over the **trimmed** answer (golden
answers written as YAML block scalars always carry a trailing newline — skipping the
trim would quietly break the "exact production prompt" promise).

### Why exposing the grader is safe

`quizEvaluator` had exactly one caller until this feature, and AGENTS.md /
`docs/codes.md` said so. That promise is now worded precisely rather than
contradicted: the grader is **never web-reachable by students** — the CopilotKit
runtime route still 404s it — and the ONE other caller is this teacher-only bearer
route. It stays safe because:

- the gate is `requireBearerTeacher` (`lib/api-auth.ts`); there is no student mode on
  the bearer channel;
- the grading `system` prompt comes from the **client**, so the server-held quiz
  `evaluation` prompts still never leave the server (the CLI assembled its copy
  offline from the teacher's own YAML);
- the agent is memory-less and the route writes nothing — the same privacy property
  as `submitAnswer`.

Stated plainly: this is a **teacher-scoped, verdict-schema-constrained LLM
pass-through**. A teacher can send arbitrary `system` / `answer` text through it.
That is acceptable under this repo's trust model — teachers already author every
activity prompt the app runs — and it is a deliberate property, not an oversight.

## Failure policy

| Situation | Behavior |
| --- | --- |
| HTTP 5xx, or a network failure | **Retry**: 4 attempts, linear backoff (5 s, 10 s, 15 s) — the shape the Python PoC needed against SCCH's occasional 504s |
| Any 4xx (bad body, unavailable provider, …) | **Terminal** — retrying cannot help |
| 401 / 403 / not signed in | **Abort the whole run** with one clear message. Token expiry mid-run is real on a 252 × 3 run; hundreds of per-case auth errors would be useless |
| A case that exhausts its retries | `errored` — the run CONTINUES |
| 3 **consecutive** fully-errored cases | **Circuit breaker**: abort. A down server fails the run in seconds instead of 252 × 4 attempts × backoff |
| Cases never attempted after an abort | `skipped` (empty `repeats` in the JSON) — honestly distinct from `errored`, so an aborted 252-case run reads "9 errored, 243 skipped", not "252 errored". Skipped cases still fail the exit-code gate (the run is incomplete) but stay out of the mismatch listing |

A provider the deployment cannot serve (e.g. the quiz declares Azure Foundry on an
SCCH-only server) is answered `400` with the reason — deliberately terminal, so it
fails fast instead of burning the retry budget on every single case.

### Troubleshooting a run-wide failure

When **every** case errors immediately, the rubric is almost never the problem — the
server is. In rough order of likelihood:

1. **The server doesn't offer the endpoint.** A deployment predating the eval feature
   answers through its cookie gate (a sign-in page), which the CLI reports as "The
   server's response is not a grading verdict — it may not offer /api/eval/grade at
   all". `whoami` succeeding proves nothing here — the bearer channel and this route
   are separate surfaces. Point `--server` at a server that has the feature (e.g. a
   local `npm run dev`).
2. **The effective provider isn't configured there** — the `400` with the
   availability reason, e.g. a Foundry override against an SCCH-only server.
3. **Auth** — aborts the whole run with one message; `novedu-cli login`.

Cheapest diagnostic: a **1-case smoke run** (a throwaway eval file with a single
answer) localises any of these for the cost of one grading call before a
hundreds-of-cases run burns its budget.

## Report semantics

**One hierarchy governs everything.** A **case** is `(questionId, answerIndex)` — one
golden answer. Repeats (`--repeats N`) are **observations** of a case.

- The case **verdict** is the **majority** over its successfully graded repeats. A
  tie passes only if **every** tied verdict is expected.
- A case that was **attempted** but got zero verdicts is `errored`; a case **never
  attempted** (the run had already aborted) is `skipped`.
- `totals`, the mismatch list, the confusion matrix, the false-correct rate and the
  **exit code** are all over CASE verdicts — never per-repeat rows. Per-repeat gating
  would make `--repeats 3` strictly harsher than `--repeats 1` and the majority vote
  decorative.
- Per-repeat rows (`repeatIndex`, `got`, `feedback`) stay in the JSON as detail,
  plus an **`unstable`** count — cases whose repeats disagreed. It is **reported but
  never gates**: grader nondeterminism is the actually interesting `--repeats`
  signal, not a failure.
- The **confusion matrix** row key is the canonical **SORTED** expected set (e.g.
  `correct|partial`) — never "first-listed", which would make the matrix depend on
  the author's list order with zero semantic difference.
- The **false-correct rate** counts cases whose expected set excludes `correct` but
  whose verdict was `correct` — the dangerous direction. The denominator is pinned to
  **all** cases whose expected set excludes `correct`, errored ones included, so it
  cannot be gamed by failures.

**Exit code**: `0` only when every file is valid AND `failed = 0` AND `errored = 0`
AND `skipped = 0` — an aborted, incomplete run must never read as a pass. `unstable`
does not gate. That makes `eval` a CI gate in the same style as `validate`. The JSON
carries the same verdict as a top-level **`passed`** (and one per file), computed FROM
`batchPassed` — the one implementation of the rule — so a script never re-derives it.

### Token usage

Every repeat row carries the `usage` of its own grading call when the server reported
one, and `totals.usage` sums them per file and across the batch (always present, zeros
when nothing was reported). **Semantics — read this before quoting a number:** usage
covers **successful grading calls only**. A call that errored, and every attempt a retry
threw away, spent tokens nobody reports, so every total is a **lower bound** on what the
run actually cost. A server that does not send `usage` simply contributes nothing; the
terminal reports and the Markdown report then print no token line at all rather than a
row of zeros.

### The Markdown report (`--report <file.md>`)

An independent file-writing side channel: it composes with `--json` / `--out`, never
touches stdout, and shares their error handling (an unwritable path is JSON on stderr,
exit 1). `cli/src/report-md.ts` is a PURE renderer over the same `EvalBatchResult`, with
the timestamp injected as a `Date` so it unit-tests byte for byte.

It is written for a **teacher**, not for a script, and follows two rules:

- **ONE uniform layout**, single file or batch (the same principle as the JSON shape):
  headline verdict + run facts, the **overview table** (one row per file — cases,
  passed/failed/errored/skipped/unstable, false-correct, tokens — plus a grand TOTAL row
  for a real batch, invalid files marked as such), then the details.
- **Details only for what went wrong**: mismatched, errored and unstable cases get a
  section each (question text, the golden answer and the grader's feedback as verbatim
  blockquotes, plus every repeat's verdict when they disagreed). Passing cases get
  nothing — the JSON has them. Skipped cases are ONE summary line with the abort reason,
  never a section each; invalid files list their validation errors; an aborted run gets a
  prominent `> [!WARNING]` block.

Teacher-authored text is treated as data: pipes and newlines are neutralized in table
cells and list items, and quoted verbatim line by line everywhere else.

The question TEXT the report shows comes from `EvalRunResult.questions`
(`{ id, text }[]`, also in the JSON), fed by `EvalCheckOk.quizQuestions` — which
`lib/eval-validate.ts` fills by re-reading the resolved quiz through the same runtime
loader (`loadQuizFrom`) the dump uses. Reporting only: it never gates a check, and a
quiz whose text could not be re-read simply yields empty texts.

## Multi-file (batch) runs

`eval` takes several eval files in one invocation — a pure CLI-side loop; the server
contract is unchanged (still one request = one golden answer).

```bash
novedu-cli eval part-1/*.eval.yaml                 # shell-expanded
novedu-cli eval "./**/*.eval.yaml"                 # quoted: the CLI expands it
```

- **Glob expansion**: an argument that is not an `http(s):`/`file:` URL and contains
  glob magic (`*`, `?`, `[]`, `{}`) is expanded via Node's built-in `fs.globSync`,
  sorted lexicographically for a deterministic run order. Plain paths and URLs pass
  through untouched, so shell-expanded globs behave identically — quoting just moves
  expansion into the CLI, which is what makes `**` (and PowerShell/cmd) work. A
  pattern matching **zero** files is a hard failure before any grading (almost
  certainly a typo). Duplicate sources are deduped with a warning.
- **Phase 1 — check all, then grade**: every file goes through `loadAndCheckEval` up
  front. An invalid file becomes a file-level `invalid` entry and the run continues
  (per-entry isolation, the same philosophy as `codes sync`). Only when **no** file is
  usable does the run end before any HTTP call — reported as JSON on stderr, exit 1.
- **Phase 2 — sequential files, concurrent cases**: files run one after another,
  `--concurrency` bounding cases *within* the current file. Server load is therefore
  identical to N separate invocations.
- **Progress** gains a file prefix: `(2/8) 0020-types.eval: 12/27`. It goes to
  **stderr** and is suppressed when stderr is not a TTY, so stdout stays clean and CI
  logs stay readable. The run's scope (`N case(s) × R repeat(s) = M grading call(s)`)
  is printed before the first call — a teacher about to fire 756 LLM calls should see
  the number first.
- **Report**: a per-file summary table, grand totals, then the per-file detail
  sections only for files that had mismatches. The confusion matrix and false-correct
  rate stay **per file** — mixing verdicts across unrelated quizzes is not meaningful.
- **`--json` / `--out`** always carry the batch shape, single file or not:
  `{ files: [{ source, status: "ok" | "invalid", passed, result?, errors? }], passed,
  totals }`, where `totals` adds `usage: { input, cachedInput, output }` and each
  `result` adds its own `totals.usage`, per-repeat `usage`, and the evaluated
  `questions: [{ id, text }]`. One shape, so scripts never branch and a glob's match
  count can never change the contract.

## Comparing models: the run override

```bash
novedu-cli eval ./welcome-quiz.eval.yaml                                   # baseline
novedu-cli eval ./welcome-quiz.eval.yaml \
  --llm-provider "Azure Foundry" --llm-model gpt-5-mini                    # comparison
```

`--llm-provider` / `--llm-model` is **strictly both-or-nothing** (mirroring the
code-override rule and `effectiveLlm`, `docs/ai-models.md`) and replaces the quiz's
`llm` pair for the whole run — every file in a batch included. Run the same rubric and
the same golden answers against a different backend and diff the two reports.

This required **zero server change**: the endpoint is already LLM-agnostic (the CLI
supplies the pair in every request body, availability-gated by the route's
`providerUnavailableReason` check). The report header renders
`quiz-llm → override-llm` and the JSON records `llm.overrides`, so a comparison
report can never be mistaken for a baseline one.

Distinguish this clearly from a **code's stored per-code LLM override**: that one
belongs to a `novedu_codes` row and is out of scope here. An eval describes a FILE —
the same rule as the prompt dump (`docs/cli-prompts.md`).

## Caveat: what you evaluated is what you must publish

A passing eval certifies the **local file you ran it on** — not the app-hosted copy a
live code serves. Publish the same file (`novedu-cli files upload`) after a green run,
or the code keeps serving the old rubric. Likewise, an override run certifies the
**override pair**, not the quiz's configured `llm`.

## Usage metering

Eval gradings are metered under the pseudo-code **`cli-eval`** and the module
**`eval`**, with the teacher's `oid` as the user (`docs/usage-metering.md`). No
pipeline change was needed — the route just sets the three sentinel RequestContext
keys. `cli-eval` is not a `novedu_codes` row (minted codes are 10 random characters,
so a collision is impossible); it simply appears as its own row/group in the usage
dashboard, with NULL code metadata.

## Tests

| Layer | File |
| --- | --- |
| Format + target resolution + cross-check | `lib/eval-validate.unit.test.ts` |
| Editor-schema drift + doc coverage | `lib/schema-gen/generated-schemas.unit.test.ts` |
| CLI purity of the format layer | `lib/prompt-dump.unit.test.ts` (`PURE_MODULES`) |
| The route (real bearer gate, mocked Mastra) | `app/api/eval/grade/route.unit.test.ts` |
| Retry + bounded concurrency | `cli/src/retry.unit.test.ts` |
| The pure runner (majority, breaker, metrics, usage) | `cli/src/eval-run.unit.test.ts` |
| The Markdown report renderer | `cli/src/report-md.unit.test.ts` |
| The command (requests, override, batch, globs) | `cli/src/commands/eval.unit.test.ts` |
| The built binary against the fixtures grader | `cli/test/eval.integration.test.ts` |

All of them are hermetic — no LLM, no DB, no secrets. The fixtures server
(`test-fixtures/serve.mjs`) fakes `/api/eval/grade` deterministically: `correct`
unless the answer carries a `[grade:<verdict>]` marker, with `evalFailures` making the
first N requests answer 504 so the retry path runs offline. See `docs/testing.md`.

## Deferred (deliberately)

"Prove it works, add stability and complexity later." Not built, and not missed yet:

- a DB-backed queue + run history + `eval status/results/delete` (the stateless design
  above was chosen over it on purpose);
- eval kinds for `writing` / `coding` / `tutor` — the `evalRunners` registry seam is
  keyed by kind and ready for them;
- image-input (photo answer) cases;
- bare directory arguments with implicit `*.eval.yaml` discovery (globs cover it),
  cross-file parallelism, a combined confusion matrix across files, per-file `--out`
  splitting.
