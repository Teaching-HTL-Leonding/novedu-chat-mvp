# `eval`: does the grading rubric actually work?

```
eval <evalPathOrUrl...> [--server <url>] [--concurrency <n>=4] [--repeats <n>=1]
                        [--llm-provider <p> --llm-model <m>] [--json] [--out <file>]
                        [--report <file.md>]
```

`prompts` shows what the grader is TOLD; `eval` shows what it DOES. Write a file
of golden answers next to the quiz, then replay them through the real grader.
Reach for it whenever the user changes an `evaluation` prompt, suspects the
grader is too lenient or too strict, or wants a regression gate before
publishing a quiz.

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
  target quiz too, and stops a typo from costing a paid run.
- **It spends real tokens.** The run prints its scope
  (`N case(s) × R repeat(s) = M grading call(s)`) before the first call — quote
  that number to the user for anything large. `--repeats 3` triples the cost.
- **Smoke-test before a large run.** One throwaway eval file with a single
  answer localises any server/auth/provider problem for the cost of ONE grading
  call. Always worth it before firing hundreds.
- **It grades THROUGH the Novedu server** (`POST /api/eval/grade`), so the
  target server must actually offer the feature. Against one that doesn't (a
  deployment predating it), every case errors with "the server's response is not
  a grading verdict" — and a passing `whoami` proves nothing about this route.
  The remedy is `--server`, e.g. `--server http://localhost:3000`.
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
- **Token totals** (`tokens: … in (… cached) / … out`) appear in the terminal
  report, the JSON (`totals.usage`) and the Markdown report. They cover only the
  gradings that SUCCEEDED, so quote them as a lower bound on what the run cost.

## Flags worth knowing

- **`--report <file.md>`** writes a Markdown report for the teacher: overview
  table, then question + golden answer + grader feedback for every
  mismatched/errored/unstable case (passing cases stay in the JSON). It composes
  with `--json`/`--out` and never touches stdout — hand the file to the user
  when they ask "what went wrong?".
- **`--llm-provider` + `--llm-model`** (both or neither) grade with a different
  backend for comparison — run once without and once with, then diff the
  reports. This is a per-RUN override; it never touches a code's stored LLM
  override.
- **`--concurrency`** defaults to 4; 6–8 is comfortable against your own dev
  server. Raise it before reaching for anything fancier on big batches.
- Progress and the scope banner go to **stderr**, the report to **stdout**, so
  `--json > report.json` and piping in general stay clean.

## Batches and failure handling

- Multi-file runs grade files one after another with a per-file summary plus
  grand totals; one invalid file is isolated (`invalid` in the report) instead of
  aborting the batch. `--json`/`--out` always carry the same `{ files, totals }`
  shape.
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
npm run cli --silent -- eval ./x.eval.yaml --json --out eval-report.json     # for CI / drilling in
npm run cli --silent -- eval ./x.eval.yaml --report eval-report.md           # readable report
```
