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

  The CLI also authenticates against Microsoft Entra ID (`login` via browser
  sign-in or `--device-code`, `logout`, `whoami`) to call the Novedu app's
  protected APIs. Use it on phrasings like "log in to novedu", "sign in the CLI",
  "who am I signed in as?", "am I authenticated?", "sign out of novedu", or
  whenever a CLI command fails with "Not signed in".

  Signed-in teachers can also MANAGE the app from the CLI: mint activity codes
  (`codes create`), list codes (`codes list`), upload app-hosted YAML files as an
  upsert (`files upload`), and list files (`files list`) — all JSON output. Use
  those on phrasings like "create a code for this quiz", "share this activity",
  "upload this YAML to the app", "publish this tutor file", "what codes do I
  have?", or "list my hosted files".
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
  document (the same gate the app applies at save / code-create time) → if the
  activity declares a document-level **prompt-fragment block** (`fragment_files:` +
  `fragments:`, the same shape a tutor's `prompt:` uses), fetch every referenced
  library, check the references + variables, and **strict-render every fragment in
  every referenced library** — exactly like a tutor. A quiz also checks that question
  ids are unique. Prompt fragments are cross-cutting: all four kinds can pull them in
  (a quiz block feeds both the grader and the discussion chat; writing/coding prepend
  it to `instructions`).

An activity that passes here is the same one the app will accept — so this is the
authoritative way to check one, not a re-implementation to second-guess. Note that
validating a tutor is **thorough**: it renders even fragments the tutor doesn't use,
so a latent template bug anywhere in a referenced library fails the tutor.

- **Exit code `0`** = valid, **`1`** = errors found. That makes it usable as a
  pre-commit / CI gate.
- Besides `validate`, the CLI has the auth commands `login` / `logout` / `whoami`
  and the teacher management groups `codes` / `files` (all below); it is built to
  grow, so check `--help` if a task sounds like it might be covered by a newer
  command.

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
any local edits to the validation core (`lib/prompt-fragments` — the shared fetch /
consistency / render / assemble pipeline all kinds use — plus `lib/tutors`,
`lib/quiz-validate`, `lib/writing-validate`, `lib/coding-validate`) — and there's
nothing to install. (The `--` passes the rest of the arguments through to the CLI.)

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
  a quiz has top-level `questions`; a writing or coding activity has top-level
  `instructions` (writing may also have `placeholder`; coding is the endpoint kind
  with no in-app chat); a fragment library has top-level `fragments` **and none of
  `prompt` / `questions` / `instructions`** (note: quiz/writing/coding may ALSO carry
  a top-level `fragments:` — their document-level fragment block — so `fragments` alone
  no longer means "library"; disambiguate by the presence of `questions`/`instructions`).
- **Relative `fragment_files`** resolve against the activity's own location — for
  ANY kind that can declare them (tutor, quiz, writing, coding): a sibling file for a
  local activity, a sibling URL for a remote one. So validate the activity where its
  fragment files actually sit. (A fragment library is self-contained — it fetches
  nothing else. An activity with no `fragment_files` fetches nothing either.)
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
| `FRAGMENT_NOT_FOUND` | The activity references a fragment id that doesn't exist in the file. |
| `MISSING_REQUIRED_VARIABLE` | A fragment needs a variable the activity didn't supply. |
| `VARIABLE_TYPE_MISMATCH` | A supplied variable is the wrong type for what the fragment declares. |
| `FRAGMENT_TEMPLATE_ERROR` | A fragment's `content` template failed to render — a Handlebars syntax error, or a reference to a variable the fragment never declares in its `input_schema`. Reported by `--kind fragment` and by the thorough whole-library check any kind runs when it declares a fragment block (tutor, quiz, writing, coding). The `fragment`/`file` context points at the offender. |
| `FETCH_FAILED` | A file/URL couldn't be read (missing local file, bad URL, network). |

For the full set, the codes come from `lib/prompt-fragments/errors.ts` in the repo
(the shared fragment core). When a schema error is vague, re-run with `--json` to see
the underlying issue detail.

## Authentication: `login`, `logout`, `whoami`

Commands that call the Novedu app's protected APIs need an Entra ID sign-in.
`validate` does NOT — it needs no login and touches no protected resource.

```
login [--device-code]     # browser sign-in — the ONE human-assisted step
logout                    # remove the cached credentials (local only)
whoami [--server <url>]   # prove the round-trip: calls GET /api/me
```

**Agent workflow for `login` — the human must finish it.** By default the
command opens the system browser for the Microsoft sign-in (and prints the
sign-in URL as a fallback), then blocks until the sign-in completes (or times
out after 5 minutes). So:

1. Run `login` in the background (or otherwise keep reading its output while it
   runs) — it is interactive by design and will not return until the human acts.
2. **Tell the user a browser window opened for the Microsoft sign-in** and ask
   them to complete it; if no window appeared, relay the printed URL.
3. First-time users get a **one-time consent prompt** ("Access Novedu APIs from
   the CLI") — tell them to accept it; it never reappears.
4. When the command prints `Signed in as <name>.`, you're done. Everything after
   `login` is non-interactive: the refresh token is cached in
   `~/.novedu/token-cache.json` (mode 0600), and commands acquire tokens
   silently from it.

`login --device-code` instead prints a verification URL + code to enter from
any device — useful on a headless machine, but many tenants **block the device
code flow** by Conditional Access policy (the sign-in page then shows error
53003). Prefer the default browser flow; only fall back to `--device-code` when
there is no local browser, and warn the user it may be blocked.

Re-running `login` while signed in just prints `Already signed in as <name>.`
and exits 0 — it never blocks, so it is safe to run defensively.

**When any command fails with `Not signed in — run "novedu-cli login".`** (exit
1), do exactly that: run `login` and relay the URL + code to the user.

**`whoami`** verifies the full chain (cache → token → server validation) and
prints the display name, user id, and whether the account is a teacher. It
targets the production server by default; pass `--server http://localhost:3000`
(or set `NOVEDU_SERVER`) against a local dev server.

## Managing codes & files: `codes`, `files` (teacher, sign-in required)

Teacher-only management over the app's bearer API — the server runs the
IDENTICAL validation pipeline as the web forms, so there is no need to
pre-validate before uploading (use `validate` for offline checks). All four
commands accept `--server <url>` (default: production; or set `NOVEDU_SERVER`).

```
codes create --module <tutor|quiz|writing|coding> --file <url>
             [--start <ISO>] [--end <ISO>] [--note <text>]
             [--llm-provider <p> --llm-model <m>]
codes list   [--search <q>] [--module <m>] [--all]
files upload <name> [--kind <tutor|fragment|quiz|writing|coding>]
             (--file <path> | reads stdin)
files list   [--search <q>] [--all]
```

- **Output is JSON only.** Success: the API's objects verbatim on **stdout**,
  pretty-printed (pipe into `jq`). Failures: JSON on **stderr** — `{ message }`
  or `{ errors: [...] }` with the full structured validation detail — and exit
  1. Read the stderr JSON to fix the exact problem instead of guessing.
- `codes create` mints a shareable code for an activity YAML at a public URL
  (or an app-hosted `…/api/files/<name>` URL). The YAML is fully validated
  server-side before the code is stored; the response includes the shareable
  `url`. `--start`/`--end` must be ISO 8601 **with an explicit offset or `Z`**
  (e.g. `2026-07-07T08:00:00Z` or `…+02:00`) — a naive datetime is rejected.
  The `--llm-provider`/`--llm-model` override pair is both-or-nothing.
- `files upload <name>` is an **upsert**: if no file named `<name>` exists it
  is created (then `--kind` is required — the error says so); if it exists, a
  new version is saved and validated against the STORED kind. A `--kind` that
  contradicts the stored kind fails with a 409 — a file's kind is frozen at
  create time. YAML comes from `--file <path>` or stdin.
- Both `list` commands default to **only your own** codes/files (like the web
  lists); `--all` widens to every teacher's. `--search` is a contains-filter.
- Downloading a file needs no command: every hosted file is public at the
  `url` the list returns (`GET /api/files/<name>`).
- A non-teacher account gets a generic 403 — verify with `whoami`
  (`Teacher: yes`).

## Scope — what this CLI does NOT do

It does not edit or delete codes, delete files, show stats/conversations, or
deploy. Those stay in the web app (deletion is deliberately bulk-only there).

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

Upload a quiz YAML to the app (creates it — the name is new, so `--kind` is
required) and mint a code for it:

```bash
npx @novedu/cli files upload sorting-quiz --kind quiz --file ./sorting-quiz.yaml
# { "name": "sorting-quiz", "kind": "quiz", "url": "https://…/api/files/sorting-quiz", "action": "created" }

npx @novedu/cli codes create --module quiz \
  --file https://…/api/files/sorting-quiz \
  --start 2026-07-07T08:00:00Z --note "3A Monday"
# { "code": "…", "url": "https://…/<code>", … }   — hand the url to students
```

Save a new version of the same file from stdin (no `--kind` needed — it exists):

```bash
cat sorting-quiz.yaml | npx @novedu/cli files upload sorting-quiz
# { …, "action": "updated" }
```

List your codes for one module, extracting just the share links:

```bash
npx @novedu/cli codes list --module quiz | jq -r '.[].url'
```
