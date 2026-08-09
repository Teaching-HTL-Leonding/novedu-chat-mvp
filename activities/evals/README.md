# Writing Eval Files (golden answers for a quiz)

An eval file is **not an activity** — you never mint a code for it and students never
see it. It is a **test file for your quiz's grading**: student answers you write
yourself, each with the verdict the grader must produce. `novedu-cli eval` replays
them through the real grader and reports where it disagreed with you.

Use it whenever you change an `evaluation` prompt, suspect the AI is too lenient or
too strict, or want a check you can re-run before publishing.

---

## 1. Quick start

Put the eval next to the quiz it tests:

```yaml
# 0010-welcome-quiz.eval.yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/activities/evals/eval-yaml.schema.json
id: welcome-quiz-eval
target: ./0010-welcome-quiz.yaml       # relative to THIS file, or an http(s) URL
questions:
  - question: what-is-a-type           # a question id of the quiz
    answers:
      - expect: correct
        answer: |
          A type describes which values a variable may hold, and what you can do
          with them.
      - expect: [partial, incorrect]   # either grading would be defensible
        answer: |
          Something about variables.
      - expect: incorrect
        answer: |
          A type is the name of the file the variable lives in.
```

```bash
# 1. Check the file — free, offline, no sign-in. Also checks the quiz it targets.
novedu-cli validate ./0010-welcome-quiz.eval.yaml --kind eval

# 2. Run it — this really calls the AI, so you must be signed in as a teacher.
novedu-cli login
novedu-cli eval ./0010-welcome-quiz.eval.yaml
```

---

## 2. File reference

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | A name for this eval, shown in the report. Letters, digits, `.`, `-`, `_`. |
| `target` | yes | The quiz this eval grades against: a path relative to the eval file, or an `http(s)` URL. |
| `questions` | yes | One entry per evaluated question; at least one. |
| `questions[].question` | yes | The **question id** in the quiz. |
| `questions[].answers` | yes | The golden answers for that question; at least one. |
| `answers[].expect` | yes | `correct`, `partial`, `incorrect`, or a **list** of the acceptable ones. |
| `answers[].answer` | yes | The student answer, verbatim. Use a `\|` block scalar for multi-line text. |

Notes:

- You do **not** have to cover every question — evaluate the ones whose grading you
  care about.
- For a **compound quiz** (`quiz_files`), question ids are namespaced:
  `question: chapter-2/what-is-a-type`. `novedu-cli prompts <quiz> --kind quiz` lists
  the exact ids.
- Use a **list** `expect` when you genuinely would accept either grading. Don't use
  it to paper over a rubric you are unsure about — that is what the eval is for.
- Eval answers are your own made-up examples. Never paste a real student's answer.
- Photo answers are not supported yet; evals are text-only.

---

## 3. Reading the report

```
✔ Eval passed — ./0010-welcome-quiz.eval.yaml
  id: welcome-quiz-eval
  target: file:///…/0010-welcome-quiz.yaml
  llm: SCCH / gemma-4
  cases: 27 × 1 repeat(s) = 27 grading call(s)

  passed: 27   failed: 0   errored: 0

  confusion (expected → got):
    correct → correct: 12
    incorrect → incorrect: 9
    partial|incorrect → partial: 6

  false-correct: 0/15 (0.0%)
```

- A **case** is one golden answer. `passed` / `failed` are per case; `errored` means
  the grading call itself never succeeded (server or network trouble). If a run
  aborts early, the answers it never got to are counted as `skipped`, not errored.
- The **confusion matrix** shows what you expected versus what the grader said. Rows
  with a `|` are list expectations.
- The **false-correct rate** is the number that matters most: answers you marked as
  *not* acceptable that the grader called `correct`. Anything above zero usually means
  the `evaluation` prompt needs a sharper "grade `incorrect` when …" clause.
- A failing run lists each mismatch as
  `question#index expected … got … "answer snippet…"` and exits with code `1`, so an
  eval works as a gate in a script or CI.

### Is the grader consistent? `--repeats`

```bash
novedu-cli eval ./0010-welcome-quiz.eval.yaml --repeats 3
```

Each answer is graded three times and the **majority** verdict counts, so one flaky
run does not fail the case. Answers whose repeats disagreed are counted as
**`unstable`** — reported, never failing. Unstable cases are the ones to make
crisper: a rubric that decides the same answer differently on different runs will do
the same to your students. (Three repeats also cost three times as much.)

### Comparing models

```bash
novedu-cli eval ./welcome.eval.yaml                                        # your quiz's model
novedu-cli eval ./welcome.eval.yaml --llm-provider "Azure Foundry" --llm-model gpt-5-mini
```

Same rubric, same golden answers, a different backend — then compare the two reports.
The two flags always go **together**. This affects only the run; it does not change
your quiz or any code you handed out.

### A whole folder at once

```bash
novedu-cli eval part-1/*.eval.yaml       # your shell expands it
novedu-cli eval "./**/*.eval.yaml"       # quoted: the CLI expands it, ** included
```

You get a per-file summary plus grand totals; a broken eval file is reported and the
others still run. `--json` / `--out <file>` write a machine-readable report (always
the same shape, one file or many).

### A report you can actually read: `--report`

```bash
novedu-cli eval ./0010-welcome-quiz.eval.yaml --report report.md
```

This writes a **Markdown report** next to the normal terminal output — open it in any
editor, or commit it so you can compare runs later. It starts with a table over the
files you ran (cases, passed/failed, unstable, false-correct) and then shows, only for
the answers that went wrong or came out unstable, the **question**, your **golden
answer** and the **grader's feedback** side by side. Cases that simply passed are left
out on purpose; the report is meant to be read, not to repeat everything.

The report also tells you what the run **cost in tokens** (input, of which cached, and
output). It counts only the gradings that succeeded, so treat it as a floor, not an
invoice.

---

## 4. Good to know

- **What you evaluated is what you must publish.** A green run certifies the file on
  your disk. If the quiz is hosted in the app, upload the same file afterwards
  (`novedu-cli files upload`) — otherwise the live code keeps serving the old rubric.
- The grading prompts are built **on your machine** from your local files, so an eval
  works on a quiz you have not pushed yet.
- Nothing is stored: no eval, no answer and no verdict is saved anywhere. The token
  usage of a run is metered like any other AI usage, under the name `cli-eval`.

The engineering reference for all of this is
[`../../docs/cli-eval.md`](../../docs/cli-eval.md); the CLI's own summary is in
[`../../cli/README.md`](../../cli/README.md).
