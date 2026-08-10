---
name: novedu-tutor-cli
description: >-
  Use `novedu-cli`, the Novedu chat app's command-line companion, for anything
  touching Novedu activity YAML or the Novedu server. It validates any activity
  file — tutor, fragment library, quiz, writing, coding, or golden-answer eval —
  with the exact pipeline the app enforces, dumps the exact LLM prompts an
  activity produces, replays a quiz's golden answers through the real grader,
  and, signed in as a teacher, mints activity codes, uploads app-hosted YAML and
  images, and triages student reports. Trigger this skill whenever the user
  wants to validate, lint or debug an activity YAML or a schema, template or
  fragment error ("is this tutor valid?", "why won't my quiz load?"); see what
  the model actually receives ("show me the grading prompt for question 3", "did
  my safety fragment reach the tutor?"); measure or regression-test a grading
  rubric ("run the eval", "is the grader too lenient?", "did my rubric change
  break anything?"); authenticate ("log in to novedu", "who am I signed in
  as?"); share or host material ("create a code for this quiz", "upload this
  diagram"); mint codes for a whole repo of course material ("sync the activity
  registry", "update the lock file"); or act on student feedback ("what have
  students reported?"). Reach for the CLI even when the user never names it — it
  is the source of truth for these rules, so prefer running it over reading YAML
  by eye or re-deriving what the app accepts.
---

# Working with `novedu-cli`

`novedu-cli` validates activity YAML with the **same pipeline the app uses** and
manages the app (codes, hosted files, images, student reports) over its
authenticated API. An activity that passes `validate` is one the app will
accept, so treat the CLI as authoritative — don't re-derive validation rules
yourself. It is built to grow: run `<command> --help` whenever a task sounds
like a newer flag or command might already cover it.

## Pick the invocation

- **Inside the app repo** (root `package.json` is named `chat-prototype`):
  `npm run cli -- <command…>` — nothing to install, works offline in the repo.
  Add `--silent` (`npm run cli --silent -- …`) whenever you pipe stdout: npm's
  own banner otherwise corrupts the JSON going into `jq`.
- **Anywhere else**: `npx @novedu/cli <command…>` — npm fetches it on demand.
  Add `@latest` if a stale cached version misbehaves; if `npx` can't reach the
  package that's a network/registry problem, not a missing publish.

## Command map

Read the reference file for the command you're about to run — each carries the
failure modes and the cost/safety notes that decide whether a run is correct.

| Command | Answers | Auth | Details |
| --- | --- | --- | --- |
| `validate <pathOrUrl> [--kind …] [--json]` | Is this file valid? | none | [references/validate.md](references/validate.md) |
| `prompts <pathOrUrl> [--kind …] [--json]` | What does the model actually receive? | none | [references/prompts.md](references/prompts.md) |
| `eval <evalPathOrUrl…>` | Does the grading rubric work? | teacher | [references/eval.md](references/eval.md) |
| `login` / `logout` / `whoami` | Who am I signed in as? | — | below |
| `codes create` / `codes list` | Share one activity with students | teacher | [references/teacher-api.md](references/teacher-api.md) |
| `codes sync <registry-file>` | Mint codes for a whole repo of material | teacher | [references/registry-sync.md](references/registry-sync.md) |
| `files upload` / `files list` | Host activity YAML in the app | teacher | [references/teacher-api.md](references/teacher-api.md) |
| `images upload` / `images list` | Host an image a quiz can show | teacher | [references/teacher-api.md](references/teacher-api.md) |
| `reports list` / `show` / `resolve` | What did students flag? | teacher | [references/teacher-api.md](references/teacher-api.md) |

## Contracts that hold across commands

- **The auth split**: `validate` and `prompts` run fully offline — no server, no
  DB, no LLM call. Everything else, `eval` included (it runs the model), needs a
  signed-in **teacher**. A non-teacher gets a generic 403, so check `whoami` for
  `Teacher: yes` before blaming the command.
- **JSON I/O contract** for `codes` / `files` / `images` / `reports`: success
  objects verbatim on stdout, exit 0; every failure a JSON `{ message }` or
  `{ errors: [...] }` on stderr, exit 1. Read the stderr JSON and act on it — the
  server's structured detail names the exact problem. (`whoami` prints
  human-readable lines, and `validate`, `codes sync` and `eval` have their own
  report formats plus `--json`, but their hard failures still follow this.)
- **The server validates, not the CLI.** Don't pre-validate before
  `codes create` / `files upload` — the server runs the identical pipeline as the
  web forms. `validate` is for offline checks, not a gate on upload.
- **`--server <url>`** is accepted by `whoami`, `codes`, `files`, `images`,
  `reports` and `eval`. It beats the `NOVEDU_SERVER` env var, which beats the
  production default. Use `--server http://localhost:3000` against a local dev
  server.
- **`--all` / `--search`**: every `list` (including `reports list`) defaults to
  **only your own** rows; `--all` widens to every teacher's, `--search` is a
  contains-filter.
- **`--kind` is caller-declared, never auto-detected**, for both `validate` and
  `prompts`. The tell-tales that identify each kind are in
  [references/validate.md](references/validate.md).
- **Exit `0` / `1`** throughout, so any of these commands works as a pre-commit
  or CI gate.

## Signing in: the human must finish `login`

`login` opens the system browser for the Microsoft sign-in (printing the URL as a
fallback) and **blocks until the human completes it** (5-minute timeout). So run
it in the background or keep reading its output, and tell the user a browser
window opened — relay the printed URL if none appeared. First-time users must
accept a one-time consent prompt ("Access Novedu APIs from the CLI").

`Signed in as <name>.` means done; everything afterwards is non-interactive (the
refresh token is cached in `~/.novedu/token-cache.json`, mode 0600, and renews
silently). Re-running while signed in prints `Already signed in as <name>.` and
exits 0, so running it defensively is safe. A command failing with
`Not signed in — run "novedu-cli login".` means exactly that.
`login --device-code` (verification URL + code, for browserless machines) is
often blocked by tenant Conditional Access policy (error 53003) — prefer the
browser flow. `whoami` verifies the whole chain (cache → token → server) and
shows name, user id and teacher status; `logout` is purely local.

## Where to start, by what the user is asking

- *"Is this valid? why won't it load?"* → `validate`, and re-run with `--json`
  when a schema error reads vague. → [validate.md](references/validate.md)
- *"Why does the tutor/grader behave like that?"* → `prompts`. Validity and
  behaviour are different questions, and a confusing prompt usually wants both
  commands. → [prompts.md](references/prompts.md)
- *"Is the grading too lenient? did my rubric change break anything?"* → golden
  answers, then `validate --kind eval`, then `eval`. It spends real tokens, so
  read [eval.md](references/eval.md) before running it.
- *"Get this in front of students."* → one-off: `files upload` + `codes create`
  ([teacher-api.md](references/teacher-api.md)). Material that lives in a repo:
  a registry file + `codes sync`, never hand-pasted codes
  ([registry-sync.md](references/registry-sync.md)).
- *"What did students say?"* → `reports list` → `show` → fix the YAML →
  `validate` → `files upload` → `reports resolve`.
  → [teacher-api.md](references/teacher-api.md)

## Scope — what the CLI does NOT do

It cannot edit or delete codes (which is why `codes sync` mints a new code
instead of changing an existing one), delete files or images, overwrite an
image, browse arbitrary stats or conversations (a reported chat's transcript is
visible only via `reports show`), file/reopen/delete reports, or deploy. Those
stay in the web app on purpose — an agent should never destroy a student's
report, and deletion is deliberately bulk-only in the web UI.

## Related material

`cli/README.md` is the human-facing counterpart to this skill; keep the two from
drifting when the CLI changes. The `novedu-teacher-docs` skill covers the teacher
guide's prose, and `novedu-publish` covers releasing the app and the CLI itself.
Note the boundary: this CLI checks whether a file is valid and what it produces —
it does not tell you what makes a good quiz question. Authoring guidance lives
with the course material.
