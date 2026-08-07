---
name: novedu-tutor-cli
description: >-
  Work with `novedu-cli`, the Novedu chat app's command-line companion: validate
  any activity YAML — a tutor, fragment library, quiz, writing, or coding
  activity — with the exact validation pipeline the app enforces; dump the exact
  LLM prompts an activity produces; sign in to
  Microsoft Entra ID; and, as a signed-in teacher, mint/list activity codes,
  upload/list app-hosted YAML files and images, and triage student reports. Use
  this skill
  whenever the user wants to validate, check, lint, or verify an activity YAML
  ("is this tutor valid?", "check my quiz", "why won't this file load?"), debug
  a schema or template error, sanity-check `tutor_instructions` /
  `fragment_files` / `questions` / `instructions`, see what the model actually
  receives ("show me the exact prompt", "what does the grader see for this
  question?", "did my safety fragment make it into the prompt?", "dump the
  prompts for an eval"), authenticate the CLI ("log in
  to novedu", "who am I signed in as?", "sign out"), share or host an activity
  ("create a code for this quiz", "upload this YAML to the app", "what codes do
  I have?", "list my hosted files", "upload this diagram so the quiz can show
  it"), mint or refresh the codes of a whole repo of course material at once
  ("sync the activity registry", "add this quiz to the book's registry", "why
  did my quiz get a new code?", "update the lock file"), or act on student
  feedback ("what have
  students reported?", "show me report <id>", "fix the issues students
  flagged", "mark these resolved") — even if they never name the CLI. Prefer the
  CLI over reading YAML by eye or re-deriving the rules: it is the source of
  truth and reports precise, actionable error codes.
---

# Working with `novedu-cli`

`novedu-cli` validates activity YAML with the **same pipeline the app uses** and
manages the app (codes, hosted files, student reports) over its authenticated
API. An activity that passes `validate` is the same one the app will accept, so
treat the CLI as authoritative — don't re-derive validation rules yourself. It
is built to grow; run `--help` if a task sounds like a newer command might cover
it.

## Pick the invocation

- **Inside the app repo** (root `package.json` is named `chat-prototype`):
  `npm run cli -- <command…>` — nothing to install, works offline in the repo.
- **Anywhere else**: `npx @novedu/cli <command…>` — npm fetches it on demand.
  Add `@latest` if a stale cached version misbehaves; if `npx` can't reach the
  package it's a network/registry issue, not a missing publish.

## Command reference

```
validate <pathOrUrl> [--kind tutor|fragment|quiz|writing|coding] [--json]
prompts  <pathOrUrl> [--kind tutor|quiz|writing|coding] [--json]

login [--device-code]        logout        whoami [--server <url>]

codes create --module <tutor|quiz|writing|coding> --file <url>
             [--start <iso>] [--end <iso>] [--note <text>]
             [--llm-provider <p> --llm-model <m>]
codes list   [--search <q>] [--module <m>] [--all]
codes sync   <registry-file> [--lock <path>] [--dry-run] [--json]
files upload <name> [--kind <kind>] (--file <path> | reads stdin)
files list   [--search <q>] [--all]
images upload <name> --file <path> [--credit <text>]
images list   [--search <q>] [--all]

reports list    [--status open|resolved|all] [--reaction good|omg|bad|holysh]
                [--search <q>] [--all]
reports show    <id>
reports resolve <id...>
```

Behaviors an agent must know:

- **`validate` and `prompts` need no sign-in**; everything under `codes` /
  `files` / `images` / `reports` needs a signed-in **teacher** (a non-teacher
  gets a generic 403 — check with `whoami`, `Teacher: yes`).
- **JSON I/O contract** (`codes`/`files`/`images`/`reports`): success objects
  verbatim
  on stdout, exit 0; every failure a JSON `{ message }` or `{ errors: [...] }`
  on stderr, exit 1. Read the stderr JSON and act on it — the server's
  structured validation detail names the exact problem. (`whoami` prints
  human-readable lines, `validate` has its own report format plus `--json`, and
  `codes sync` prints a per-entry report with `--json` for the machine shape —
  its hard failures still follow the contract above.)
- **The server validates, not the CLI.** Don't pre-validate before
  `codes create` / `files upload` — the server runs the identical pipeline as
  the web forms. Use `validate` for offline checks.
- Both `list` commands and `reports list` default to **only your own**
  codes/files/reports; `--all` widens to every teacher's. `--search` is a
  contains-filter.
- `codes create`: the YAML at `--file <url>` (public, or an app-hosted
  `…/api/files/<name>` URL) is validated server-side before the code is stored;
  the response includes the shareable `url`. `--start`/`--end` must be ISO 8601
  **with an explicit offset or `Z`** — a naive datetime is rejected. The
  `--llm-provider`/`--llm-model` pair is both-or-nothing.
- `codes sync <registry-file>` is the PREFERRED way to mint codes for **material
  kept in a repo** (a course, a book, a worksheet collection) — see the
  registry workflow below. Keep `codes create` for genuine one-offs.
- `files upload <name>` is an **upsert**: a new name requires `--kind`; an
  existing file's kind is frozen at create time (contradicting `--kind` →
  409). Existing codes keep serving the file, so uploading a fix needs no
  re-share. Every hosted file is public at the `url` the list returns.
- `images upload <name>` is **create-only** (unlike files there is no upsert):
  a taken name → 409 — images are immutable; delete + re-upload happens in the
  web app (`/images`). `--file` is **required** (`.png`, `.jpg`/`.jpeg` or
  `.svg`, max 5 MB — the type comes from the extension; binary, so no stdin);
  `--credit` stores an optional attribution. Reference the uploaded image from
  activity YAML by NAME with `hosted: true` (e.g. a quiz question's
  `image: { src: <name>, hosted: true, alt: … }`); the `url` in `images list`
  is a short-lived SAS link for previewing, never for embedding.
- `whoami`, `codes`, `files`, `images`, and `reports` accept `--server <url>` (beats the
  `NOVEDU_SERVER` env var, which beats the production default) — pass
  `--server http://localhost:3000` against a local dev server.

## `validate`: kinds and results

`--kind` is caller-declared, not auto-detected. Tell-tales: a **tutor** has
top-level `prompt`; a **quiz** has `questions`; **writing**/**coding** have
`instructions`; a **fragment library** has `fragments` and none of the others.
Careful: quiz/writing/coding may ALSO carry a top-level `fragments:` (their
document-level fragment block), so `fragments` alone doesn't mean "library".

- Validation is **thorough**: any kind that declares a fragment block
  (`fragment_files:` + `fragments:`) gets every fragment in every referenced
  library strict-rendered — a latent template bug anywhere in a referenced
  library fails the activity, even for fragments it doesn't use. `--kind
  fragment` checks one library standalone.
- Relative `fragment_files` resolve against the activity's own location
  (sibling file or sibling URL) — validate the activity where its fragment
  files actually sit.
- Exit `0` = valid, `1` = errors — usable as a pre-commit / CI gate. `--json`
  prints the raw result object for drilling into the exact failing
  variable/fragment/field.

Act on the specific error code rather than just relaying it:

| Code | Meaning |
| --- | --- |
| `YAML_PARSE_ERROR` | Not valid YAML (indentation, syntax). |
| `TUTOR_SCHEMA_ERROR` | Tutor fields wrong/missing — often a typo'd key (strict schema). |
| `FRAGMENT_FILE_SCHEMA_ERROR` | A referenced fragment file has invalid structure. |
| `QUIZ_SCHEMA_ERROR` | Quiz document wrong/missing a field, or has no questions. |
| `DUPLICATE_QUIZ_QUESTION_ID` | Two questions share an `id` (the stats key must be unique). |
| `WRITING_SCHEMA_ERROR` | Writing document wrong — usually missing `instructions` or `llm.model`. |
| `CODING_SCHEMA_ERROR` | Coding document wrong — missing field, or an unsupported one like `anonymous`. |
| `FRAGMENT_NOT_FOUND` | The activity references a fragment id the file doesn't define. |
| `MISSING_REQUIRED_VARIABLE` | A fragment needs a variable the activity didn't supply. |
| `VARIABLE_TYPE_MISMATCH` | A supplied variable has the wrong type. |
| `FRAGMENT_TEMPLATE_ERROR` | A fragment template failed to render — Handlebars syntax, or an undeclared variable; `fragment`/`file` context points at the offender. |
| `FETCH_FAILED` | A file/URL couldn't be read (missing file, bad URL, network). |

When a schema error is vague, re-run with `--json` for the underlying detail.

## `prompts`: what the model actually receives

`prompts` prints the EXACT system prompts an activity YAML produces, built by the
app's own prompt builders and runtime loaders — never a re-derivation. Use it
whenever the question is about BEHAVIOR rather than validity ("why does the
grader accept this?", "does my safety fragment reach the tutor?", "show me the
grading prompt for question 3"), and when preparing prompt evals. Offline, no
sign-in; `--kind` is caller-declared like `validate`'s, minus `fragment` (a
library has no prompt of its own — its fragments show up rendered inside the
activity that places them).

```bash
npm run cli --silent -- prompts ./my-quiz.yaml --kind quiz --json | jq -r '.grading.questions[0].system'
npx @novedu/cli prompts ./my-tutor.yaml           # human summary: id, model, chars per prompt
npx @novedu/cli prompts https://raw.githubusercontent.com/…/my-tutor.yaml   # published activity
```

- The argument is a **path or a public `http(s)` URL** (`<pathOrUrl>`, same as
  `validate`); relative `fragment_files` / `quiz_files` / `text_files` resolve
  against the activity's own location — sibling file, or sibling URL. "Offline"
  means no server, no DB and no LLM call, not "no network".
- Envelope: `{ kind, id, llm: { provider, model } }` — the FILE's own `llm`; a
  code's per-code LLM override is not applied.
- **quiz** adds `grading` (`questions[].system` — the full grading prompt per
  question, `imageInput`, the `userMessageTemplate` /
  `userMessagePhotosOnly` wrappers, and `responseSchema`, the grader's JSON
  Schema) and `discussion` (`system`, the three `seedMessages` templates,
  `verdictLabels`). For a compound quiz the questions are the RESOLVED pool:
  namespaced `"<alias>/<id>"` ids, each carrying its source quiz's preamble.
- **tutor** / **writing** give `system`; **coding** gives `system` plus
  `upstreamSystemMessage` (what the proxy puts on the wire — appended to the
  calling agent's last system message so the teacher has the final word).
- It runs the RUNTIME load path, so failures are one `ACTIVITY_LOAD_FAILED` JSON
  error on stderr, exit 1. For structured authoring errors run `validate` — the
  two are complementary, and a confusing prompt usually wants both.

## Signing in: the human must finish `login`

`login` opens the system browser for the Microsoft sign-in (printing the URL as
a fallback) and blocks until the human completes it (5-minute timeout), so:

1. Run `login` in the background (or keep reading its output while it runs).
2. Tell the user a browser window opened for the Microsoft sign-in; relay the
   printed URL if no window appeared. First-time users must accept a one-time
   consent prompt ("Access Novedu APIs from the CLI").
3. `Signed in as <name>.` means done. Everything afterwards is
   non-interactive: the refresh token is cached in
   `~/.novedu/token-cache.json` (mode 0600) and tokens renew silently.

Re-running `login` while signed in prints `Already signed in as <name>.` and
exits 0 — safe to run defensively. Any command failing with
`Not signed in — run "novedu-cli login".` means exactly that: run `login`.
`login --device-code` (verification URL + code, for browserless machines) is
often blocked by tenant Conditional Access policy (error 53003) — prefer the
browser flow. `whoami` verifies the whole chain (cache → token → server) and
shows name, user id, and teacher status. `logout` is purely local.

## The publish loop for repo-based material: the activity registry

Material that lives in a git repo (a course, a book, a worksheet set) should
NOT accumulate hand-pasted codes. Keep one hand-written **registry** file next
to it and let `codes sync` do the minting:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/activities/registry/registry-yaml.schema.json
# ddp-activities.yaml — hand-written, committed
base-url: "https://raw.githubusercontent.com/acme/course/refs/heads/main/"
activities:          # groups: quizzes | tutors | writing | coding
  quizzes:
    welcome:         # the KEY the material references; unique across all groups
      file: 0010-introduction/0010-welcome-quiz.yaml
      note: "Course: Welcome (0010)"
    exam:
      file: 0030-conditions/exam-quiz.yaml
      start: 2026-09-01T00:00:00+02:00     # offset or Z, whole seconds
      end: 2027-01-31T23:59:59+01:00
```

```bash
npm run cli --silent -- codes sync ddp-activities.yaml     # or npx @novedu/cli …
# → per-entry report; writes ddp-activities.lock.yaml (activity-codes: key → code)
```

Adding an activity is then: write + `validate` the YAML → push → add ONE
registry entry → `codes sync` → commit registry **and** lock file → reference
the key from the material. Never paste a code by hand again.

What an agent must know before running it:

- **Re-running is the normal case, not a risk.** An entry that matches an
  existing code of yours (same URL, module, window, LLM override — `note` is
  NOT part of matching) reuses it. Run `--dry-run` first when unsure; it mints
  and writes nothing.
- **Changing a window or an override mints a NEW code.** The old one is never
  modified or deleted (the API has no update endpoint); it is reported as
  superseded and keeps working. Say so before changing those fields — links
  already handed to students will not follow.
- **The lock file is generated: commit it, never edit it.** Keys sorted, one
  `activity-codes` map. Removing a registry entry drops the key from the lock;
  the server code stays and is reported as orphaned.
- **Exit 1 with a `failed` entry** means the server rejected that activity
  (usually the YAML at the URL) — the other entries still synced, and the lock
  kept that entry's previous code. Fix the YAML, push, re-run.
- **Registry errors abort before ANY minting**, reported as JSON on stderr with
  the exact YAML path. Common ones: a group name other than the four above, a
  key that is not lowercase-kebab, a duplicate key across groups, `file:`
  without a `base-url` ending in `/`, a naive datetime, a window bound with
  milliseconds (the server stores whole seconds), and an entry with no fields at
  all — the shape a mis-indented entry takes, which is why it is an error rather
  than an ignored annotation.
- `--json` gives `{ entries: [{ key, module, fileUrl, action, code?, url?,
  error? }], warnings }` for scripting.

## The report-driven enhancement loop

Students flag an AI interaction — a chat or a graded quiz answer — with a
reaction and an optional note. Those flags usually point at something to fix in
the activity YAML, which is exactly this CLI's job:

1. `reports list` — see what students flagged (default: open reports on your
   codes; `--reaction holysh` surfaces the urgent ones).
2. `reports show <id>` — read the report. A **chat** report embeds the
   conversation transcript (`messages` array), so one command gives both the
   flag and the discussion behind it; a **quiz-answer** report carries its
   question / answer / feedback snapshot inline.
3. Fix the activity YAML the report's `code` points at; `validate` the change
   offline.
4. `files upload <name>` — save the fix as a new version; existing codes serve
   it immediately, no re-share.
5. `reports resolve <id...>` — close what you addressed (bulk, one request;
   unknown or already-resolved ids are silently ignored).

Pass `--status`/`--reaction` values verbatim — the server validates them, so an
unknown value returns a `400 { message }` on stderr, not a silent empty list.

## Scope — what the CLI does NOT do

It cannot edit or delete codes (so `codes sync` mints a new one instead of
changing an existing one), delete files or images (or overwrite an
image), browse arbitrary
stats/conversations (a reported chat's transcript is visible only via
`reports show`), file/reopen/delete reports, or deploy. Those stay in the web
app on purpose — an agent should never destroy a student's report, and deletion
is deliberately bulk-only in the web UI.

## Examples

```bash
# Inside the repo: validate a known-good sample tutor (exit 0)
npm run cli -- validate activities/examples/sorting-algorithms/sorting-tutor.yaml

# See the assembled system prompt, then one question's grading prompt
npm run cli --silent -- prompts activities/examples/sorting-algorithms/sorting-tutor.yaml --json | jq -r .system
npm run cli --silent -- prompts activities/examples/sorting-algorithms/sorting-quiz.yaml --kind quiz --json \
  | jq -r '.grading.questions[0].system'

# Host a quiz and mint a code for it (new name → --kind required)
npx @novedu/cli files upload sorting-quiz --kind quiz --file ./sorting-quiz.yaml
npx @novedu/cli codes create --module quiz \
  --file https://…/api/files/sorting-quiz \
  --start 2026-07-07T08:00:00Z --note "3A Monday"
# → { "code": "…", "url": "https://…/<code>", … }   — hand the url to students

# Triage a report end-to-end
npx @novedu/cli reports show 3f2c… | jq '{reaction, description, messages}'
npx @novedu/cli files upload sorting-quiz --file ./sorting-quiz.yaml
npx @novedu/cli reports resolve 3f2c…

# Host an image, then reference it from a quiz question by name
npx @novedu/cli images upload sorting-diagram --file ./diagram.png --credit "CC BY 4.0"
# → in the YAML:  image: { src: sorting-diagram, hosted: true, alt: "…" }

# Course material in a repo: one registry entry, then sync (safe to re-run)
npx @novedu/cli codes sync ddp-activities.yaml --dry-run   # what would happen
npx @novedu/cli codes sync ddp-activities.yaml             # writes the lock file
# → commit ddp-activities.yaml AND ddp-activities.lock.yaml
```
