# `eval`: does the grading rubric actually work?

```
eval <evalPathOrUrl...> [--server <url>] [--concurrency <n>=4] [--repeats <n>=1]
                        [--llm-provider <p> --llm-model <m>]
                        [--no-judge-feedback | --judge-llm-provider <p> --judge-llm-model <m>]
                        [--json] [--out <file>] [--report <file.md>]
```

`prompts` shows what the grader is TOLD; `eval` shows what it DOES. Write a file
of golden answers next to the quiz, then replay them through the real grader.
Reach for it whenever the user changes an `evaluation` prompt, suspects the
grader is too lenient or too strict, or wants a regression gate before
publishing a quiz.

It checks **both halves** of what the grader produces: the golden `expect` gates the
**verdict**, and an LLM **feedback judge** audits the **feedback text** the student would
have seen. The judge needs no extra authoring — it measures the feedback against the
quiz's own grading prompt (see below).

Needs a signed-in teacher — it runs the model.

## The eval file

```yaml
# 0010-welcome-quiz.eval.yaml — next to the quiz
# yaml-language-server: $schema=https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/activities/evals/eval-yaml.schema.json
id: welcome-quiz-eval
target: ./0010-welcome-quiz.yaml     # relative to THIS file, or an http(s) URL
questions:
  - question: what-is-a-type         # a question id of the RESOLVED quiz
    answers:
      - expect: correct
        answer: |
          A type describes which values a variable may hold.
      - expect: [partial, incorrect] # more than one grading is defensible
        answer: |
          Something about variables.
```

For a compound quiz, `question:` must use the namespaced `"<alias>/<id>"` form —
`prompts --kind quiz` lists the resolved ids.

## Before you run it

- **`validate --kind eval` first.** It is free and offline, strict-checks the
  target quiz too, and stops a typo from costing a paid run. Note the asymmetry:
  `validate` takes exactly ONE file while `eval` is variadic and glob-aware, so
  `validate "<glob>"` fails with a 404 naming the literal glob — loop instead
  (`references/validate.md`).
- **It spends real tokens.** The run prints its scope
  (`N case(s) × R repeat(s) = M grading + M judge call(s)`) before the first call —
  quote that number to the user for anything large. `--repeats 3` triples the cost, and
  feedback judging roughly **doubles** it. `--no-judge-feedback` halves a run back to
  verdicts only — the right mode for a cheap smoke run.
- **Smoke-test before a large run.** One throwaway eval file with a single
  answer localises any server/auth/provider problem for the cost of ONE grading
  call. Always worth it before firing hundreds.
- **It grades THROUGH the Novedu server** (`POST /api/eval/grade`), so the
  target server must actually offer the feature. Against one that doesn't (a
  deployment predating it), every case errors with "the server's response is not
  a grading verdict" — and a passing `whoami` proves nothing about this route.
  The remedy is `--server`, e.g. `--server http://localhost:3000`.
  **The judge is a SECOND route** (`POST /api/eval/judge`) with its own
  deployment age: a server can grade fine and still not know how to judge. If
  judging degrades from the very first case, suspect a server predating the
  feature before you suspect the judge model, and point `--server` somewhere that
  has it.
- **Grading prompts are assembled LOCALLY** from the file on disk, so an
  unpushed edit is what gets evaluated. A green run certifies **your local
  file**, not the app-hosted copy a live code serves — follow up with
  `files upload`.

## Reading the report

- **Hierarchy**: a *case* is one golden answer; `--repeats` are repeated
  observations of it, and the case verdict is the **majority** (a tie passes
  only if every tied verdict is expected). Totals, the confusion matrix, the
  false-correct rate and the exit code are all over *case* verdicts.
- **`unstable`** (repeats disagreed) is reported but never fails the run. Report
  it as "the grader is nondeterministic on these", not as a bug in the rubric.
- **Read the false-correct rate out loud when it is non-zero**: those are
  answers the teacher marked as not acceptable that the grader accepted —
  usually the rubric needs a sharper "grade `incorrect` when…" clause.
- **Exit `0`** only when every file is valid and `failed = 0`, `errored = 0`,
  `skipped = 0`. A mismatch is a rubric finding, not a CLI error — fix the
  `evaluation` prompt (or the golden answer, if the expectation was wrong) and
  re-run.
- **`flagged feedback`** counts cases whose feedback the judge objected to. Like
  `unstable`, it is reported and **never fails the run** — the verdicts were fine, the
  wording was not. Read the flags out loud: they are usually a fragment-library rule the
  grader ignored (most often "state the correct answer when the verdict is not
  `correct`"), which is a fix in the `evaluation` prompt or the shared instructions, not
  in the golden answers.
- **Token totals** (`tokens: … in (… cached) / … out`) appear in the terminal
  report, the JSON (`totals.usage`) and the Markdown report. Grading and judge tokens
  share ONE bucket, and only calls that SUCCEEDED are counted — quote them as a lower
  bound on what the run cost.

## The feedback judge

- **What it checks**: the feedback text, against the **grading system prompt the grader
  ran with** — nothing else. That prompt already contains the rules (the course's shared
  instructions plus the platform frame), so there is **no judge guide to author**. Four
  criteria: `contradicts_verdict`, `misstates_facts`, `ignores_instructions`,
  `leaks_rubric`.
- **On by default.** `--no-judge-feedback` skips it entirely (halves the LLM calls).
- **`--judge-llm-provider` + `--judge-llm-model`** (both or neither) judge on a different
  model than the grader — the **recommended** setup, because a strong judge over a small
  grader flags real problems where the small grader judging itself mostly flags noise.
  Without them the judge uses the effective grading pair. Combining them with
  `--no-judge-feedback` is a usage error.
- **It never fails a run.** Flags land in `totals.feedbackFlagged`, in the report's
  Flagged column and in a **"Flagged feedback"** section (per case: question, golden
  answer, each flagged repeat's verdict + feedback, then `criterion — note` items). In
  the JSON they are `repeats[].judge.issues` plus the per-case `feedbackFlagged`.
- **If the judge model itself is down**, judging *degrades* rather than aborting: after 3
  consecutive judge failures it stops for the rest of the run (one stderr warning,
  `judging: "degraded"`) and the grading finishes normally. Tell the user their verdict
  results are complete but the feedback was NOT audited. Files that judged nothing render
  an em dash in Flagged rather than a `0`, so "unchecked" never reads as "clean".

## Flags worth knowing

- **`--report <file.md>`** writes a Markdown report for the teacher: overview
  table, then question + golden answer + grader feedback for every
  mismatched/errored/unstable case, plus the "Flagged feedback" section (passing,
  unflagged cases stay in the JSON). It composes
  with `--json`/`--out` and never touches stdout — hand the file to the user
  when they ask "what went wrong?".
- **`--llm-provider` + `--llm-model`** (both or neither) grade with a different
  backend for comparison — run once without and once with, then diff the
  reports. This is a per-RUN override; it never touches a code's stored LLM
  override. It is independent of the judge pair.
- **`--concurrency`** defaults to 4; 6–8 is comfortable against your own dev
  server. Raise it before reaching for anything fancier on big batches.
- **A large batch can run for a very long time** — hundreds of cases means hours,
  not minutes. Do not quote a rate or an ETA: throughput depends on the grading
  model, the provider's load and `--concurrency`, and it varies enough between
  runs that any number you give will be wrong. Warn the user it may take **up to
  several hours** and let the scope banner speak for the size.
- The scope banner goes to **stderr** and the report to **stdout**, so
  `--json > report.json` and piping in general stay clean. The live `12/27`
  counter is a **TTY-only spinner**; off a TTY you instead get **one
  newline-terminated line per finished file** (`(2/8) 0020-types.eval: 27
  case(s), 27 passed, …`). So a redirected run is greppable and provably alive —
  but it only ticks on file BOUNDARIES, so a single long file still shows nothing
  for a while. Judge liveness by whether files are still landing, never by
  instantaneous silence. (Do not diagnose it from CPU either: `npm run cli` nests
  several processes deep and the outer shims legitimately burn none.)
- **`--json` is what switches stdout to JSON**; `--out <file>` only ADDS the
  file. So `--json --out r.json` prints the JSON *and* writes it, while `--out
  r.json` alone keeps the human report on stdout.

## Batches and failure handling

- Multi-file runs grade files one after another with a per-file summary plus
  grand totals; one invalid file is isolated (`invalid` in the report) instead of
  aborting the batch. `--json`/`--out` always carry the same `{ files, totals }`
  shape.
- **Every report is written ONCE, after the last file.** There is no incremental
  flush and no `--resume`. The run is durable *within* the process — a bad file is
  isolated, and even an aborted run still writes its report — but if the process
  dies you lose the whole batch, however far it got. For anything long, split it
  into per-folder invocations with their own `--report`/`--out` names, so a
  failure costs one batch instead of the lot.
- Failures are handled for you: 5xx/network is retried (4 attempts, linear
  backoff), any 4xx is terminal, an auth failure aborts the run (`login` again),
  and three consecutive errored cases trip a circuit breaker. If you see that
  breaker, the server is down, unreachable, or lacks the feature — not the
  rubric.
- After an abort, untried cases are reported as **`skipped`**, not errored. A
  "3 errored, 249 skipped" report means ~3 real failures, not 252 — say so
  rather than alarming the user.

## Examples

```bash
npm run cli --silent -- validate ./0010-welcome-quiz.eval.yaml --kind eval   # free, offline
npm run cli --silent -- eval ./0010-welcome-quiz.eval.yaml                   # runs the model
npm run cli --silent -- eval "./part-1/**/*.eval.yaml"                       # quote the glob
npm run cli --silent -- eval ./x.eval.yaml --repeats 3                       # stability check
npm run cli --silent -- eval ./x.eval.yaml --no-judge-feedback               # verdicts only, half the calls
npm run cli --silent -- eval ./x.eval.yaml \
  --judge-llm-provider "Azure Foundry" --judge-llm-model gpt-5.6-terra       # strong judge (recommended)
npm run cli --silent -- eval ./x.eval.yaml --json --out eval-report.json     # for CI / drilling in
npm run cli --silent -- eval ./x.eval.yaml --report eval-report.md           # readable report
```
