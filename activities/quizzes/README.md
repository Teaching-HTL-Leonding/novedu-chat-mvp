# Writing Quiz Files

This guide explains **quiz definitions** — the YAML files that describe an
LLM-graded, open-ended quiz — so that teachers can write their own quizzes
without touching any code. This folder holds the guide and the JSON schema;
complete sample files live in [`../examples/`](../examples/).

You do not need to be a programmer. If you can edit a structured text file and
follow the examples below, you can build a quiz.

---

## 1. The idea in one minute

A quiz is a list of **open-ended questions**. There are deliberately no
multiple-choice options: the student answers in their own words, and the **LLM
grades each answer** against a private grading prompt you write.

For every question you write two things the student never sees together:

- a **question** — the Markdown shown to the student, and
- an **evaluation** — a server-only grading prompt that embeds the expected
  answer and the rubric.

The model returns a structured verdict — **correct**, **partial**, or
**incorrect** — plus written feedback the student sees immediately. After seeing
the feedback the student can open a short **discussion chat** about that question.

```
quiz file (your questions)
┌─────────────────────────────────────────────┐
│ question  → shown to the student            │
│ evaluation → SERVER-ONLY grading prompt     │  ──▶  LLM grades the answer
│              (expected answer + rubric)     │       → correct | partial | incorrect
└─────────────────────────────────────────────┘       → feedback (+ optional discussion)
```

Because grading is just another prompt, a question can ask for reasoning, an
explanation, or a short calculation — anything the model can judge from your
rubric.

---

## 2. Quick start — a complete minimal example

A tiny quiz, `my-quiz.yaml`:

```yaml
id: capitals-basics
name: "Capital Cities — Basics"
title: "Capitals Quiz"
description: "A short quiz on capital cities. Answer in your own words."
anonymous: false # record which student each attempt belongs to
shuffle: true # random question order per attempt
llm:
  model: RedHatAI/gemma-4-31B-it-FP8-Dynamic
questions:
  - id: capital-australia
    title: "Capital of Australia"
    question: |
      What is the **capital city of Australia**?
    evaluation: |
      The correct answer is **Canberra**.

      Grade as:
      - `correct`   — names Canberra (any reasonable spelling).
      - `partial`   — mentions Canberra among other guesses, or describes it.
      - `incorrect` — names Sydney, Melbourne, or any other city.
```

This repository ships complete examples you can copy from:

- [`../examples/sorting-algorithms/sorting-quiz.yaml`](../examples/sorting-algorithms/sorting-quiz.yaml)
  — a seven-question quiz about sorting algorithms with code-reading questions,
  a discussion prompt, and `shuffle: false` (the questions build on each other).
- [`../examples/review-writing/review-writing-quiz.yaml`](../examples/review-writing/review-writing-quiz.yaml)
  — an anonymous English-class quiz about writing reviews and feedback letters.

---

## 3. Editor support

This folder includes a JSON Schema for quiz YAML files: `quiz-yaml.schema.json`.
It is **generated from the zod schema** in `lib/quiz-schema.ts` via
`npm run generate:schemas` — do not edit it by hand.

Editors that use the YAML Language Server, including VS Code with YAML support,
can pick up the schema from a modeline comment at the top of a quiz file:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/activities/quizzes/quiz-yaml.schema.json
```

The sample files in [`../examples/`](../examples/) use this **full raw GitHub URL** so that validation,
completion, and hover help work in your editor **whether or not** the schema file
happens to sit next to the YAML you are editing. (If your file _is_ next to the
schema, the relative path `./quiz-yaml.schema.json` works too.)

In VS Code, install the Red Hat YAML extension to get this schema support:
<https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml>.

The line is a comment, not a YAML field. The app ignores it, but the editor can
use it for validation, completion, and hover help. (The schema is for editor hints;
the app validates with its own checks — see [Validating your quiz](#7-validating-your-quiz).)

---

## 4. Quiz file reference

A quiz file has these fields. All of them are required unless marked optional.

```yaml
id: my-quiz # short machine name, e.g. capitals-basics
name: "My Quiz" # optional: human-readable label
title: "Welcome!" # optional: greeting students see on the welcome screen
description: "What this quiz covers." # optional: shown below the greeting
anonymous: false # optional: omit for default true; false attributes each attempt
shuffle: true # optional: omit for default true; false keeps the authored order
llm:
  model: RedHatAI/gemma-4-31B-it-FP8-Dynamic # which model grades + discusses
  imageInput: true # optional: omit for default false; students may attach photos
discussion: # optional: guidance for the per-question follow-up chat
  instructions: |
    ...
questions: # at least one; each is graded by the LLM
  - id: ...
    question: |
      ...
    evaluation: |
      ...
```

### `id`

Required. A short machine-readable identifier for the quiz.

### `title` and `description`

Both optional. Students see them on the welcome screen before the first question:
`title` replaces the default greeting (omit it to keep the default), and
`description` appears below it as Markdown. Write the `description` for your
students.

### `anonymous`

Optional, **default `true`**. By default a quiz is anonymous: answers are recorded
for aggregate statistics but **not** linked to a student. Set `anonymous: false`
to attribute each attempt to the signed-in student (e.g. for graded work). The
flag is **frozen** onto the quiz code when the code is created — editing the YAML
later does not change a live code.

### `shuffle`

Optional, **default `true`**. When true, questions are presented in a random order
per attempt. Set `shuffle: false` to keep the authored order (useful when later
questions build on earlier ones).

### `llm.model`

Required. The model that **grades** the answers and **drives** the per-question
discussion chat. Same id space as a tutor's `llm.model`.

### `llm.provider`

Optional, default `SCCH` (the school's self-hosted server). Set
`provider: Azure Foundry` to grade and discuss on an Azure OpenAI deployment
instead — then `llm.model` is the **deployment name** (e.g. `gpt-5.4-mini`).

The `llm:` values are the **default**: when a teacher mints a code for this
activity, the code's create/edit form can **override provider + model per
code** (always both together) — the YAML file itself stays unchanged.

### `llm.imageInput`

Optional, **default `false`**. When `true`, students can attach **photos** to
their answers — for example a picture of a handwritten calculation — and the
model grades the photo together with (or instead of) the typed text. Up to
3 photos per answer, 5 MB each; an answer may even be photo-only.

The model must be **vision-capable** (able to look at images). This also
applies to a per-code model override on such a quiz.

The quiz-level flag is the default for all questions; an `imageInput` on a
single question overrides it in either direction (see below).

### `discussion.instructions`

Optional. Guidance appended to the system prompt of the follow-up **discussion
chat** a student can open on any question after seeing their feedback. The app
already gives the assistant full context (the question, the expected answer, the
student's answer, and the verdict), so this is only extra steering. Omit it to use
a sensible default.

### `fragment_files` and `fragments` (reusable prompt pieces)

Optional. A quiz may pull in **prompt fragments** — the same reusable, parameterized
pieces tutors use (a persona, a safety policy, a set of ground rules). Declare them
at the **top level** of the quiz file, exactly as a tutor declares them under
`prompt:`:

```yaml
fragment_files:
  - id: shared # the alias you refer to below
    url: "../shared/general-fragments.yaml" # relative to this quiz file, or a full http(s) URL

fragments:
  - file: shared
    id: safety
  - file: shared
    id: persona
    variables:
      subject: "sorting algorithms"
```

The fragments are assembled once (in `priority` order) and **prepended to BOTH** the
private grading prompt and the follow-up discussion chat — so a shared safety or
persona rule applies to how the model grades **and** how it discusses. Your
per-question `evaluation` and your `discussion.instructions` stay **plain text** (no
templating); the fragments come first, your text follows. Omit both fields when the
quiz uses no fragments.

The full fragment mechanics — fragment libraries, `input_schema`, `variables`,
`priority`, and how a shared library is written — are documented in the tutor guide,
[`../tutors/README.md`](../tutors/README.md). The shared library
[`../examples/shared/general-fragments.yaml`](../examples/shared/general-fragments.yaml)
is reused across activity kinds.

---

## 5. Questions and grading

`questions` is a list with **at least one** entry. Each question:

| Field         | Required | What it is                                                                       |
| ------------- | -------- | -------------------------------------------------------------------------------- |
| `id`          | yes      | Stable id, **unique** within the quiz — the per-question stats key.               |
| `title`       | no       | Short label for the stats table and progress display.                            |
| `question`    | yes      | The **Markdown** shown to the student (math via `$…$` and code fences render).    |
| `evaluation`  | yes      | The **grading prompt**. SERVER-ONLY — never sent to the browser.                  |
| `image`       | no       | An optional content image shown above the question (see below).                  |
| `imageInput`  | no       | Overrides the quiz-level `llm.imageInput` for this question only (photo answers on/off). |

The `evaluation` is the heart of a question. Because it never reaches the browser,
it can freely state the expected answer and the criteria for each verdict. Write
it as a short rubric, for example:

```yaml
evaluation: |
  The correct answer is **Canberra**.

  Grade as:
  - `correct`   — names Canberra (any reasonable spelling).
  - `partial`   — unsure but mentions Canberra, or describes it without naming it.
  - `incorrect` — names Sydney, Melbourne, or any other city.

  In the feedback, confirm or gently correct the student.
```

The model returns one of the three verdicts — **correct**, **partial**,
**incorrect** — and the feedback text the student sees. The verdicts you name in
the rubric are what the model maps an answer onto, so name all three.

### Content images

A question may carry an optional `image`, rendered above its Markdown:

```yaml
image:
  hosted: true # look the image up by NAME in the app's image store (server-side)
  src: sample-compass-rose # the hosted name (when hosted) or a URL / relative path
  alt: A compass rose showing the four cardinal directions. # accessible description
  credit: Compass rose — CC BY 4.0 # optional attribution shown below the image
```

Omit `hosted` (or set it `false`) to use an absolute `http(s)` URL or a path
relative to the quiz's own URL as `src`. The image carries no secret, so it
crosses to the browser (unlike `evaluation`).

---

## 6. Hosting your quiz

The server fetches your quiz over the internet, so it must be at a **public
`http(s)` URL**.

The easiest option is GitHub:

1. Put your `.yaml` file in a public repository.
2. Use the **raw** URL of the file, for example:
   `https://raw.githubusercontent.com/<org>/<repo>/refs/heads/main/activities/quizzes/my-quiz.yaml`
3. **Commit and push** before validating or creating a code — the server reads the
   published version, not your local copy.

Alternatively, **host the quiz in the app itself** — no GitHub needed. On the
**YAML Files** page (`/files`) a teacher can create, edit and version a quiz file
(kind **Quiz**); it is served at `https://<origin>/api/files/<name>` and drops
straight into a quiz code. The file is **validated when you save it**.

A quiz is shared like any activity: mint a **code** pointing at the quiz URL and
hand the `/<code>` link to students.

---

## 7. Validating your quiz

Validation runs the same structural checks the app enforces, so a broken quiz is
caught **before** a student opens it — an invalid quiz cannot be saved or turned
into a code.

In the app, open **YAML Files** (`/files`), create or edit your quiz (kind
**Quiz**), and press:

- **Validate** — checks the YAML **without** saving, or
- **Validate & save** — checks again and stores a new version; an invalid save is
  rejected with the specific errors.

From the terminal or CI, use the CLI:

```bash
novedu-cli validate ./quizzes/my-quiz.yaml --kind quiz
```

The validator checks, in order:

1. The file is valid YAML.
2. The quiz has the correct structure — no missing or misspelled fields, an
   `llm.model`, and at least one question (each with an `id`, a `question`, and an
   `evaluation`).
3. Every question `id` is unique.

### Common problems and how to fix them

| Reported problem            | What it means                                                  | How to fix                                    |
| --------------------------- | -------------------------------------------------------------- | --------------------------------------------- |
| `YAML_PARSE_ERROR`          | The file isn't valid YAML.                                     | Check indentation and quotes.                 |
| `QUIZ_SCHEMA_ERROR`         | A field is missing, has the wrong type, or is misspelled (the detail lines name the field). | Compare against this guide; fix the named field. A numeric-looking `id` must be **quoted**. |
| `DUPLICATE_QUIZ_QUESTION_ID`| Two questions share an `id`.                                   | Give each question a distinct `id`.           |
| `FETCH_FAILED`              | The URL couldn't be loaded.                                    | Check the URL is public and pushed.           |

---

## 8. Checklist before you publish

- [ ] The quiz has an `id`, an `llm.model`, and **at least one** question.
- [ ] Every question has an `id`, a `question`, and an `evaluation`.
- [ ] Every question `id` is **unique**.
- [ ] Numeric-looking ids are **quoted** (e.g. `id: "1"`).
- [ ] `anonymous` is set the way you want — default `true` (not attributed).
- [ ] The file is **public** and **pushed** (if hosted on GitHub).
- [ ] You validated the quiz and it passes.
