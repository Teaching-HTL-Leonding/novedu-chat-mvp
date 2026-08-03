---
name: novedu-tutor-cli
description: >-
  Work with `novedu-cli`, the Novedu chat app's command-line companion: validate
  any activity YAML — a tutor, fragment library, quiz, writing, or coding
  activity — with the exact validation pipeline the app enforces; sign in to
  Microsoft Entra ID; and, as a signed-in teacher, mint/list activity codes,
  upload/list app-hosted YAML files and images, and triage student reports. Use
  this skill
  whenever the user wants to validate, check, lint, or verify an activity YAML
  ("is this tutor valid?", "check my quiz", "why won't this file load?"), debug
  a schema or template error, sanity-check `tutor_instructions` /
  `fragment_files` / `questions` / `instructions`, authenticate the CLI ("log in
  to novedu", "who am I signed in as?", "sign out"), share or host an activity
  ("create a code for this quiz", "upload this YAML to the app", "what codes do
  I have?", "list my hosted files", "upload this diagram so the quiz can show
  it"), or act on student feedback ("what have
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

login [--device-code]        logout        whoami [--server <url>]

codes create --module <tutor|quiz|writing|coding> --file <url>
             [--start <iso>] [--end <iso>] [--note <text>]
             [--llm-provider <p> --llm-model <m>]
codes list   [--search <q>] [--module <m>] [--all]
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

- **`validate` needs no sign-in**; everything under `codes` / `files` /
  `images` / `reports` needs a signed-in **teacher** (a non-teacher gets a
  generic 403 — check with `whoami`, `Teacher: yes`).
- **JSON I/O contract** (`codes`/`files`/`images`/`reports`): success objects
  verbatim
  on stdout, exit 0; every failure a JSON `{ message }` or `{ errors: [...] }`
  on stderr, exit 1. Read the stderr JSON and act on it — the server's
  structured validation detail names the exact problem. (`whoami` prints
  human-readable lines, and `validate` has its own report format plus
  `--json`.)
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

It cannot edit or delete codes, delete files or images (or overwrite an
image), browse arbitrary
stats/conversations (a reported chat's transcript is visible only via
`reports show`), file/reopen/delete reports, or deploy. Those stay in the web
app on purpose — an agent should never destroy a student's report, and deletion
is deliberately bulk-only in the web UI.

## Examples

```bash
# Inside the repo: validate a known-good sample tutor (exit 0)
npm run cli -- validate activities/examples/sorting-algorithms/sorting-tutor.yaml

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
```
