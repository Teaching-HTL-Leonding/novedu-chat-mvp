---
title: Test how your quiz grades
description: Write sample answers with the marks they should get, run them through the real grader, and see where your grading criteria disagree with you.
sidebar:
  order: 6
audience: teacher
keywords: [eval, golden answers, grading, test the grader, rubric, evaluation, false-correct, repeats, unstable, quiz, report, tokens, cost]
related:
  - 10-yaml-for-teachers/04-cli-validation
  - 10-yaml-for-teachers/05-see-the-prompt
  - 20-building-activities/04-quizzes
generated: true
---

<!--
  GENERATED FILE, do not edit by hand.
  Edit the chapter prompt in teacher-docs/prompts/10-yaml-for-teachers/06-testing-the-grader.prompt.md and regenerate.
-->

Validation tells you your quiz file is well-formed. The prompt dump shows what the AI is told. This chapter closes the loop: it shows what the AI actually **does**. You write a handful of student answers yourself (a good one, a half one, a confidently wrong one), note the mark each should get, and the CLI's `eval` command grades them with the same grader your students meet. That's what "evaluation" means in practice, and it turns "the AI feels too lenient" into a number you can check again after every edit.

## Write a few golden answers

Create a small YAML file next to your quiz and name it after it, for example `sorting-quiz.eval.yaml`. Each entry names a question of the quiz, a made-up student answer, and the mark you expect:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/activities/evals/eval-yaml.schema.json
id: sorting-quiz-eval
target: ./sorting-quiz.yaml          # relative to THIS file, or a web address
questions:
  - question: bubble-idea            # a question id of the quiz
    answers:
      - expect: correct
        answer: |
          Bubble Sort vergleicht immer zwei benachbarte Zahlen und tauscht sie,
          wenn die linke größer ist. Das macht man über das ganze Array, dadurch
          wandert die größte Zahl ans Ende. Dann wiederholt man das Ganze so
          lange, bis in einem Durchlauf nichts mehr getauscht wird.
      - expect: [partial, incorrect] # either mark would be defensible
        answer: |
          Man vergleicht Zahlen und tauscht sie irgendwie, bis es passt.
      - expect: incorrect
        answer: |
          Man sucht das kleinste Element im Array und tauscht es an die erste
          Stelle, dann das zweitkleinste an die zweite, und so weiter.
```

`expect` is `correct`, `partial`, or `incorrect`. When more than one mark is genuinely defensible, list the ones you would accept, as the second answer above does. The first comment line is the editor schema address; with it, VS Code checks the file and completes field names as you type, the same way it does for your activity files.

Two rules for the answers themselves. They are **your own invented examples**: never paste a real student's answer into an eval file. And you don't need to cover every question; write answers for the ones whose grading you care about.

The question ids must match the quiz. For a final quiz assembled from several chapter quizzes, the imported ids carry the chapter's alias as a prefix; the `prompts` command from the previous chapter lists the exact ids if you're unsure.

## Check the file, for free

```bash
npx @novedu/cli validate ./sorting-quiz.eval.yaml --kind eval
```

This checks the eval file offline: no sign-in, no AI call, no cost. It also checks the quiz the file points at and that every question id really exists there, so a typo never costs you a paid run.

## Run it against the real grader

Running the eval really calls the AI, so you need to be signed in as a teacher:

```bash
npx @novedu/cli login
npx @novedu/cli eval ./sorting-quiz.eval.yaml
```

Before the first call, the run prints its size, so you always see what you're about to spend:

```
3 case(s) × 1 repeat(s) = 3 grading call(s)
```

Then comes the report. Here is a real run over the sample file above:

```
✔ Eval passed — sorting-quiz.eval.yaml
  id: sorting-quiz-eval
  target: file:///…/sorting-quiz.yaml
  llm: SCCH / RedHatAI/gemma-4-31B-it-FP8-Dynamic
  cases: 3 × 1 repeat(s) = 3 grading call(s)

  passed: 3   failed: 0   errored: 0
  tokens: 2,312 in (2,240 cached) / 2,098 out

  confusion (expected → got):
    correct → correct: 1
    incorrect → incorrect: 1
    partial|incorrect → partial: 1

  false-correct: 0/2 (0.0%)
```

## Read the report

Work through it in this order:

- **passed / failed / errored.** One golden answer is one case. `passed` means the grader gave a mark you accept, `failed` means it didn't, and `errored` means the grading call itself never succeeded (server or network trouble, not your quiz). If a run stops early, answers it never got to are counted as `skipped` rather than errored.
- **The mismatch lines.** When the grader disagrees with you, each disagreement gets one line naming the question, the expected mark, the mark the AI gave, and the start of the answer:

  ```
  1 mismatch(es):
    ✗ bubble-idea#1 expected incorrect got partial "Man vergleicht Zahlen und tauscht sie irgendwie, bis es pas…"
  ```

- **The confusion table** is "what I expected versus what it said", one line per combination. Rows with a `|` come from answers where you listed several acceptable marks.
- **The false-correct rate** counts answers you marked as *not* acceptable that the grader nevertheless called `correct`, out of all answers where `correct` wasn't acceptable. This is usually the number worth acting on: anything above zero means the grader is letting wrong answers through. The fix is almost always a sharper sentence in the question's `evaluation` text, of the form "grade `incorrect` when the answer …", naming exactly the mistake it just accepted.

A run with any mismatch finishes with exit code 1, so you can use it as a check in a script; that one sentence is all you need to know about it.

The `tokens` line under the counts shows what the run spent: input tokens (with the cached share in brackets) and output tokens. It answers "what did this eval cost me?" and lets you roughly compare what two models charge for the same golden answers. The count covers the grading calls that succeeded.

## Is the grading consistent?

An AI grader isn't perfectly deterministic: the same answer can occasionally get a different mark on a different day. To measure that, grade every answer several times:

```bash
npx @novedu/cli eval ./sorting-quiz.eval.yaml --repeats 3
```

Each answer is graded three times and the **majority** mark counts, so one odd run doesn't fail a case; asking for repeats never makes the check stricter. Answers whose runs disagreed are reported as **unstable**. That's information, not a failure, but it's information worth having: a criterion that decides the same answer differently on different runs will do the same to two students who wrote the same thing. Unstable answers are the ones whose `evaluation` wording deserves sharpening. Keep in mind that three repeats also cost three times as much.

## Try a different AI model

You can grade the same golden answers with a different model, without touching the quiz:

```bash
npx @novedu/cli eval ./sorting-quiz.eval.yaml --llm-provider "Azure Foundry" --llm-model gpt-5-mini
```

The two flags always go together. Run the eval once without them and once with, then compare the two reports: same criteria, same answers, different model. This changes only the run itself. Your quiz file keeps its own model, and any code you've already handed out is unaffected.

## A whole folder at once

Several eval files can go into one run:

```bash
npx @novedu/cli eval "./quizzes/**/*.eval.yaml"
```

You get a per-file summary plus grand totals. A broken eval file is reported as invalid and the others still run, so one typo doesn't sink the batch.

## Keep a readable report

The terminal output is gone when you close the window. To keep a run, add the `--report` flag:

```bash
npx @novedu/cli eval "./quizzes/**/*.eval.yaml" --report eval-report.md
```

It writes the run as a Markdown file: an overview table first, then details only for the answers that need your attention. Here is the overview of a real two-file run:

```markdown
| File | Eval | Cases | Passed | Failed | Errored | Skipped | Unstable | False-correct | Tokens (in / cached / out) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ✅ sorting-quiz.eval.yaml | `sorting-quiz-eval` | 3 | 3 | 0 | 0 | 0 | 0 | 0/2 (0.0%) | 2,312 / 2,240 / 2,099 |
| ❌ mismatch.eval.yaml | `sorting-quiz-eval` | 3 | 2 | 1 | 0 | 0 | 0 | 0/2 (0.0%) | 2,312 / 2,240 / 2,181 |
| **TOTAL** |  | **6** | **5** | **1** | **0** | **0** | **0** |  | **4,624 / 4,480 / 4,280** |
```

Below the table, every disagreement gets its own section with the question, your golden answer, and the grader's feedback side by side, so you can judge on the spot whether the grader had a point:

```markdown
### `bubble-idea` #1 — expected incorrect, got partial

**Question**

> Erkläre in eigenen Worten, wie **Bubble Sort** ein Array von Zahlen
> sortiert. Was passiert in einem einzelnen Durchlauf, und warum ist das
> Array am Ende sortiert?

**Golden answer**

> Man vergleicht Zahlen und tauscht sie irgendwie, bis es passt.

**Grader feedback**

> Du hast die Grundidee schon richtig erkannt: Es geht beim Sortieren ums
> Vergleichen und Tauschen. Deine Antwort ist allerdings noch etwas zu
> ungenau, um den **Bubble Sort** exakt zu beschreiben.
```

Passing answers stay out of the details on purpose; a clean run produces a short, quiet file. The report is plain Markdown, so it reads well in your editor's preview, renders nicely on GitHub, and can sit next to the quiz in your repository or go to a colleague by mail. Keeping the report of the run you did before handing out a quiz also documents that you tested it.

## How many answers do you need?

Three or four per question you care about is already useful: one clearly right, one half-right, one confidently wrong. The confidently wrong ones earn their keep, because they're the answers that find a lenient rubric. Grow the file over time; whenever the grader surprises you in class, add that kind of answer (rewritten in your own words) with the mark it should have got, and the surprise becomes a permanent test.

## What you tested is what you must publish

A green run certifies the file **on your machine**. If your quiz is hosted in the app, upload the same file afterwards, otherwise the shared code keeps grading with the old criteria you just improved. Nothing else is stored anywhere: no eval file, no answer, and no mark is saved by a run.

Two current limits: eval files are text-only, so photo answers can't be tested this way yet, and an eval file is not an activity: it never gets a code and students never see it.

## Ask an AI assistant instead

The Novedu repository bundles a skill that teaches AI coding assistants (such as Claude Code) how to use the CLI. With such an assistant you can say "write golden answers for my sorting quiz", "run the eval", or "explain these mismatches", and it drafts the file, runs the commands, and tells you which `evaluation` sentence to sharpen, so you never have to remember a flag.
