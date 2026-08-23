# Teacher-guide chapter notes

Guardrails for editing the teacher guide in `teacher-docs/src/content/docs/`. Each entry
holds only what a chapter does **not** say plainly itself: facts that are easy to
get wrong, things a chapter must not claim, and scope boundaries between
chapters. Voice and audience rules live in `teacher-docs/style.md` and the
`novedu-teacher-docs` skill, not here.

Most chapters have no entry. That is not an omission: it means the chapter's own
prose carries everything an editor needs.

## Rules that span chapters

- **No version numbers and no release history**, for the app, the CLI, or the
  skills tool. The app is under heavy development, so a version is stale within
  weeks. Describe how things behave now.
- **SCCH is a PARTNER the school buys hosting from**, not hardware the school
  owns: never "the school's own server", "self-hosted", or "in-house". Expand it
  once as "the school's Austrian LLM hosting partner"; later mentions are "SCCH"
  or "the school's hosting partner".
- The **`00-introduction/**` chapters are concept level**: no YAML field names
  and no configuration steps, those belong to the later chapters.

## 10-yaml-for-teachers/06-testing-the-grader

- Never state a rate, a per-answer time or a total for a whole-course run: speed
  depends on the model and how busy it is, it changes over time, and a concrete
  number would read as a promise. "Up to several hours" is as precise as it gets.
- Flagged feedback is reported, never a failure. Do not let the chapter suggest a
  run can fail because of it, and do not present the judge as a second opinion on
  the MARK — it only ever looks at the wording.
- A passing run certifies the file on the teacher's own machine. If the quiz is
  hosted in the app, the same file still has to be uploaded afterwards, or the
  shared code keeps serving the old criteria. The most important caveat in the
  chapter; the same holds for a tutor eval.
- Nothing is stored: no eval file, no answer, no mark and no judgment is saved
  anywhere. Same for tutor evals.

## 10-yaml-for-teachers/07-testing-a-tutor

- Nothing gates. A flagged response and a missing tool call are both notes. The
  exit code reflects run health only: an invalid file, a call that errored, a case
  the run never reached.

## 20-building-activities/02-available-llms

- The per-code override's provider and model are both-or-nothing, and a reasoning
  level only works alongside them. The override replaces the WHOLE `llm:` block,
  so an override that names no reasoning level also drops the one in the YAML.
- Do not print a fixed list of model names; they are school-set and change. Naming
  a model when describing how it handles reasoning levels is fine, that is a
  measured observation, but frame it as an example of the three behaviours rather
  than a catalogue.
- Do not invent prices, rates, or budgets; there are none in the sources. Say
  which side costs money per use and let the teacher act on it.
- This chapter sits closest to internals: describe the teacher's choice and its
  effect, never how a provider connects or authenticates.

## 20-building-activities/04-quizzes

- In a compound quiz, `instructions` is the ONE thing that is not ignored, and it
  must NOT be described as "ignored": the chapter quiz's top-level `instructions:`
  text TRAVELS with its questions, but for GRADING only, and it is ADDITIVE — the
  final quiz's own `instructions` apply first, then the chapter's on top. Do NOT
  claim an imported question is graded identically to how its chapter quiz grades
  it.
- `question_count` bounds one attempt only, in the student's browser: it is not a
  server-enforced exam limit, nothing stops a reload starting a fresh attempt, and
  a repeated question is simply graded again.

## 20-building-activities/07-fragments

- There is no `priority` and no separate `fragments:` list any more; order is
  simply where you place the marker. If an older activity still has them, it is
  the old format. Do not describe priority ordering.
- Keep this the one deep fragment chapter: the tutors, quiz, writing and coding
  chapters cover placing fragments from the consumer side and should stay lighter.

## 30-sharing-activities/01-creating-codes

- Ownership rules differ per object and must not be mixed up: a **code's** owner
  is the teacher who created it and never changes hands, while a hosted **file's**
  or **image's** owner is whoever saved it LAST.

## 30-sharing-activities/02-viewing-usage

- An orientation, not a full dashboard manual. Keep it short.

## 30-sharing-activities/08-activity-registry

- Do not describe matching as a lookup by name: the app knows nothing about the
  registry, and the names live only in the two files in the repository.

## 40-ai-llms/01-novedu-cli

- Keep the CLI part at overview level. Do not duplicate the validate, prompts,
  eval, or codes chapters; name what the CLI can do and let the later chapters
  teach the commands.

## 40-ai-llms/02-llms-txt

- Don't promise what any specific assistant can do. Phrase abilities as "an
  assistant that can fetch web pages", and name products only as examples, never
  as a complete or guaranteed list.
