---
name: novedu-tutor-cli
description: >-
  Validate any Novedu activity YAML -- a tutor, a fragment library, a quiz, a
  writing activity, or a coding activity -- with the `novedu-cli` CLI, which runs
  the exact same checks the app enforces (YAML parse, schema check, and for tutors
  the cross-reference / variable consistency, per-fragment template rendering, and
  system-prompt assembly). Use this skill whenever the user wants to validate,
  check, lint, or verify a tutor, fragment library, quiz, writing, or coding YAML,
  debug a schema or template error, sanity-check `tutor_instructions` /
  `fragment_files` / `questions` / `instructions`, or confirm an activity is correct
  before committing or publishing it -- even if they don't name the CLI. Validating
  a tutor also fully validates every fragment library it references; validate a
  library, quiz, writing, or coding file on its own with `--kind`.

  Reach for it on phrasings like "is this tutor valid?", "check my tutor.yaml", "is
  this fragment library okay?", "validate my quiz", "check my writing activity", "is
  my coding YAML correct?", "why won't this load?", or any request to verify a YAML
  authored for the Novedu chat app. Prefer this CLI over reading the YAML by eye or
  re-deriving the rules -- the CLI is the source of truth and reports precise error
  codes you can act on.
---

# Validating activity YAML with `novedu-cli`

`novedu-cli` is the command-line companion for the Novedu chat app. Its first
command, `validate`, takes an activity YAML (a local file or a public URL) and runs
the **same** validation pipeline the app uses. What it checks depends on the kind:

- **tutor** (default): parse YAML → schema-check the tutor and every referenced
  fragment file → check that fragment references and their variables line up →
  **strict-render every fragment in every referenced library** → assemble the final
  system prompt. If all of that succeeds the tutor is valid.
- **fragment**: check a **fragment library on its own** — parse YAML → schema-check
  the file → ensure fragment ids are unique → strict-render each fragment's template
  against its own declared `input_schema` (catching syntax errors and references to
  undeclared variables). This verifies a library a fragment author maintains, without
  needing a tutor.
- **quiz** / **writing** / **coding**: parse YAML → strict schema-check the activity
  document (the same gate the app applies at save / code-create time). A quiz also
  checks that question ids are unique.

An activity that passes here is the same one the app will accept — so this is the
authoritative way to check one, not a re-implementation to second-guess. Note that
validating a tutor is **thorough**: it renders even fragments the tutor doesn't use,
so a latent template bug anywhere in a referenced library fails the tutor.

- **Exit code `0`** = valid, **`1`** = errors found. That makes it usable as a
  pre-commit / CI gate.
- `validate` is the only command today; the CLI is built to grow, so check
  `--help` if a task sounds like it might be covered by a newer command.

## Pick the right invocation: inside the repo vs. outside

The command differs depending on **where you are**. Decide first:

**Inside the app repo** — the working directory is the chat-prototype /
`novedu-chat-mvp` repository (tell-tale signs: the root `package.json` has
`"name": "chat-prototype"` and a `cli/` workspace; the sample activities live
under `activities/examples/`, grouped by topic, with the per-module authoring
guides + JSON schemas in `activities/tutors/`, `activities/quizzes/`,
`activities/writings/`, `activities/coding/`). Run it straight from source, no
build or install needed:

```bash
npm run cli -- validate <pathOrUrl> [--kind <kind>] [--json]
```

Use this form in the repo because it runs the live workspace code, so it reflects
any local edits to the validation core (`lib/tutors`, `lib/quiz-validate`,
`lib/writing-validate`, `lib/coding-validate`) — and there's nothing to install. (The
`--` passes the rest of the arguments through to the CLI.)

**Outside the repo** — any other folder, e.g. a teacher authoring activities in their
own directory. Use the published package via `npx`:

```bash
npx @novedu/cli validate <pathOrUrl> [--kind <kind>] [--json]
```

> `@novedu/cli` is published on npm, so `npx` fetches it on demand — no install
> or clone needed. Add `@latest` (`npx @novedu/cli@latest …`) to force the newest
> version if a stale one is cached. If `npx` genuinely can't reach the package,
> it's a network/registry issue, not a missing publish.

**How to decide:** if the current directory (or the file you're validating) is
inside the app repo, use `npm run cli`; otherwise use `npx @novedu/cli`. When
unsure, a quick check for a root `package.json` named `chat-prototype` settles it.

## The `validate` command

```
validate <pathOrUrl> [--kind tutor|fragment|quiz|writing|coding] [--json]
```

- **`<pathOrUrl>`** — either a **local file path** (e.g. `./activities/tutors/my-tutor.yaml`)
  or a public **http(s) URL** (e.g. a raw GitHub link to an activity YAML).
- **`--kind`** — what the file is: `tutor` (the default), `fragment`, `quiz`,
  `writing`, or `coding`. The CLI does **not** auto-detect; pass the right `--kind`
  for anything other than a tutor. Rough tell-tales: a tutor has top-level `prompt`;
  a fragment library has top-level `fragments`; a quiz has top-level `questions`; a
  writing or coding activity has top-level `instructions` (writing may also have
  `placeholder`; coding is the endpoint kind with no in-app chat).
- **Relative `fragment_files`** in a tutor resolve against the tutor's own
  location: a sibling file for a local tutor, a sibling URL for a remote one. So
  validate the tutor where its fragment files actually sit. (Fragment, quiz, writing,
  and coding files are self-contained — those kinds fetch nothing else.)
- **`--json`** — print the raw result object instead of the formatted report.
  Use this when you need to inspect specifics programmatically (drill into the
  exact failing variable/fragment/field, feed CI, etc.). Without it you get a
  human-readable pass/fail summary.

## Reading the result

The report separates **errors** (the activity is invalid — must fix) from
**warnings** (it still builds, but something is worth a look). On failure, act on
the specific error code rather than just relaying it:

| Code | Meaning |
| --- | --- |
| `YAML_PARSE_ERROR` | The file isn't valid YAML (indentation, syntax). |
| `TUTOR_SCHEMA_ERROR` | The tutor's fields are wrong/missing (often a typo'd key — the schema is strict). |
| `FRAGMENT_FILE_SCHEMA_ERROR` | A referenced fragment file has invalid structure. |
| `QUIZ_SCHEMA_ERROR` | The quiz document is wrong/missing a field, or has no questions (`--kind quiz`; the strict schema catches typo'd keys). |
| `DUPLICATE_QUIZ_QUESTION_ID` | Two quiz questions share an `id` (the per-question stats key must be unique). |
| `WRITING_SCHEMA_ERROR` | The writing document is wrong/missing a field — usually a missing `instructions` or `llm.model` (`--kind writing`). |
| `CODING_SCHEMA_ERROR` | The coding document is wrong/missing a field — usually a missing `instructions` or `llm.model`, or an unsupported field like `anonymous`/`description`/`placeholder` (`--kind coding`). |
| `FRAGMENT_NOT_FOUND` | The tutor references a fragment id that doesn't exist in the file. |
| `MISSING_REQUIRED_VARIABLE` | A fragment needs a variable the tutor didn't supply. |
| `VARIABLE_TYPE_MISMATCH` | A supplied variable is the wrong type for what the fragment declares. |
| `FRAGMENT_TEMPLATE_ERROR` | A fragment's `content` template failed to render — a Handlebars syntax error, or a reference to a variable the fragment never declares in its `input_schema`. Reported by `--kind fragment` and by the thorough tutor check (whole-library). The `fragment`/`file` context points at the offender. |
| `FETCH_FAILED` | A file/URL couldn't be read (missing local file, bad URL, network). |

For the full set, the codes come from `lib/tutors/errors.ts` in the repo. When a
schema error is vague, re-run with `--json` to see the underlying issue detail.

## Scope — what this CLI does NOT do

It only **validates**. It does not authenticate, create or delete codes, deploy, or
talk to the running app. Don't offer those via this CLI; validation needs no login
and touches no protected resource.

## Examples

Inside the repo, a known-good sample tutor:

```bash
npm run cli -- validate activities/examples/sorting-algorithms/sorting-tutor.yaml
# ✔ Valid tutor — activities/examples/sorting-algorithms/sorting-tutor.yaml   (exit 0)
```

Inside the repo, a broken tutor (a synthetic test fixture) — exit 1, with actionable codes:

```bash
npm run cli -- validate test-fixtures/activities/tutors/broken-tutor.yaml
# ✘ Invalid tutor … MISSING_REQUIRED_VARIABLE / FRAGMENT_NOT_FOUND   (exit 1)
```

Inside the repo, validating a fragment library on its own:

```bash
npm run cli -- validate activities/examples/shared/general-fragments.yaml --kind fragment
# ✔ Valid fragment file — activities/examples/shared/general-fragments.yaml   (exit 0)
```

Inside the repo, validating a quiz, a writing activity, and a coding activity:

```bash
npm run cli -- validate activities/examples/sorting-algorithms/sorting-quiz.yaml --kind quiz
# ✔ Valid quiz — activities/examples/sorting-algorithms/sorting-quiz.yaml   (exit 0)

npm run cli -- validate activities/examples/review-writing/restaurant-review-letter.yaml --kind writing
# ✔ Valid writing activity — …   (exit 0)

npm run cli -- validate activities/examples/sorting-algorithms/sorting-visualizer.yaml --kind coding
# ✔ Valid coding activity — …   (exit 0)
```

Outside the repo, validating a published tutor by URL:

```bash
npx @novedu/cli validate https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/activities/examples/sorting-algorithms/sorting-tutor.yaml
```

Machine-readable output for scripting/CI:

```bash
npx @novedu/cli validate ./my-quiz.yaml --kind quiz --json
```
