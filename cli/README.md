# @novedu/cli

Command-line companion for the Novedu chat app (installed command: `novedu-cli`;
requires Node >= 20). It covers two jobs:

- **Validate activity YAML** — tutors, fragment libraries, quizzes, writing
  activities, and coding activities — with the app's exact validation pipeline,
  offline and without signing in.
- **Manage the app as a teacher** — sign in with Microsoft Entra ID, then mint
  activity codes, upload app-hosted YAML files and images, and triage student
  reports, straight from the terminal (or from a coding agent, see below).

No install needed:

```bash
npx @novedu/cli --help
```

## Validating activities: `validate`

```bash
# Validate a local tutor (relative fragment_files resolve against the file's location)
npx @novedu/cli validate ./activities/examples/sorting-algorithms/sorting-tutor.yaml

# Validate a published activity by URL
npx @novedu/cli validate https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/activities/examples/sorting-algorithms/sorting-tutor.yaml

# Other kinds: fragment library, quiz, writing activity, coding activity
npx @novedu/cli validate ./activities/examples/shared/general-fragments.yaml --kind fragment
npx @novedu/cli validate ./activities/examples/sorting-algorithms/sorting-quiz.yaml --kind quiz

# Machine-readable output (the raw validation result)
npx @novedu/cli validate ./my-quiz.yaml --kind quiz --json
```

- `--kind` accepts `tutor` (default), `fragment`, `quiz`, `writing`, or
  `coding`; it is caller-declared, not auto-detected.
- The CLI reuses the app's exact validation pipeline (`lib/prompt-fragments`,
  `lib/tutors`, `lib/quiz-validate`, `lib/writing-validate`,
  `lib/coding-validate`), so an activity that passes here is the same one the
  app accepts — no separate, drifting rules. Validating a tutor also fully
  validates every fragment library it references.
- Exit code `0` = valid, `1` = errors found — usable as a pre-commit / CI gate.

## Authentication

Commands that talk to the running app authenticate with Microsoft Entra ID:

```bash
npx @novedu/cli login    # opens your browser for the Microsoft sign-in
npx @novedu/cli whoami   # verify: calls the app's GET /api/me with your token
npx @novedu/cli logout   # remove the cached credentials from this machine
```

- `login` opens a browser window for the Microsoft sign-in (and prints the URL
  as a fallback). **First-time users see a one-time consent prompt** ("Access
  Novedu APIs from the CLI") — accept it once and it never reappears. When
  already signed in, `login` just says so and exits.
- On a machine without a browser, `login --device-code` prints a verification
  URL and a code to enter from any other device. Note that tenants commonly
  block the device code flow by Conditional Access policy (error 53003) — the
  default browser flow is not affected.
- Credentials are cached in `~/.novedu/token-cache.json` (directory `0700`,
  file `0600`). The cache holds a refresh token, so after the one sign-in every
  command runs non-interactively; treat the file like a credential. `logout`
  is purely local — issued tokens expire on their own (~1 h).
- `whoami` proves the full round-trip and shows your display name, user id, and
  whether the account is a teacher (`Teacher: yes/no`) — the management
  commands below need a teacher account.
- The server defaults to the production app; override per command with
  `--server <url>` or the `NOVEDU_SERVER` env var (e.g.
  `http://localhost:3000` for development). Other deployments of the app can
  point the CLI at their own tenant/app registration via `NOVEDU_TENANT_ID` /
  `NOVEDU_CLIENT_ID`.
- Not signed in (or the cached token expired for good)? Commands exit 1 with
  `Not signed in — run "novedu-cli login".`

## Managing codes, files & images (teacher account required)

The `codes`, `files` and `images` groups call the app's API as the signed-in
teacher. The
server runs the identical validation pipeline as the web forms and is
authoritative — the CLI sends your input as-is and relays the server's answer.

```
codes create  --module <tutor|quiz|writing|coding> --file <url>
              [--start <iso>] [--end <iso>] [--note <text>]
              [--llm-provider <p> --llm-model <m>]
codes list    [--search <q>] [--module <m>] [--all]
codes sync    <registry-file> [--lock <path>] [--dry-run] [--json]
files upload  <name> [--kind <tutor|fragment|quiz|writing|coding>]
              (--file <path> | reads stdin)
files list    [--search <q>] [--all]
images upload <name> --file <path> [--credit <text>]
images list   [--search <q>] [--all]
```

- **Output is JSON only.** Success: the API's objects verbatim on stdout, exit
  0 (pipe into `jq`). Failure: JSON on stderr — `{ message }` or
  `{ errors: [...] }` with the full structured validation detail — and exit 1.
- `codes create` mints a shareable code for an activity YAML at a public URL
  (or an app-hosted `…/api/files/<name>` URL); the YAML is validated
  server-side before the code is stored, and the response includes the
  shareable `url`. `--start`/`--end` must be ISO 8601 **with an explicit
  offset or `Z`** (e.g. `2026-07-07T08:00:00Z`); the
  `--llm-provider`/`--llm-model` override pair is both-or-nothing.
- `codes sync <registry-file>` mints codes for a whole **course** at once — see
  [Many activities at once](#many-activities-at-once-codes-sync) below.
- `files upload <name>` is an **upsert**: creating a new file requires
  `--kind`; an existing file's kind is frozen at create time (a contradicting
  `--kind` fails with 409). The YAML comes from `--file <path>` or stdin.
  Every hosted file is public at the `url` the list returns — no download
  command needed.
- `images upload <name>` uploads a **new** app-hosted image — `.png`,
  `.jpg`/`.jpeg` or `.svg` (the type comes from the file extension), max 5 MB.
  Unlike `files upload` it is **create-only**: a taken name fails with 409 —
  images are immutable; delete + re-upload in the web app (`/images`) to
  replace one. `--file` is required (images are binary — no stdin);
  `--credit` stores an optional attribution shown with the image. The bytes go
  straight to Azure Blob Storage (the CLI runs the same request → upload →
  confirm flow as the web form). Reference the image from activity YAML by
  name with `hosted: true`.
- `images list` shows your images with a short-lived download `url` (a ~3 h
  SAS link — share the *name*, not this URL).
- All `list` commands default to **only your own** codes/files/images (like the
  web lists); `--all` widens to every teacher's, `--search` is a
  contains-filter.

Example — host a quiz and share it:

```bash
npx @novedu/cli files upload sorting-quiz --kind quiz --file ./sorting-quiz.yaml
# { "name": "sorting-quiz", "kind": "quiz", "url": "https://…/api/files/sorting-quiz", "action": "created" }

npx @novedu/cli codes create --module quiz \
  --file https://…/api/files/sorting-quiz \
  --start 2026-07-07T08:00:00Z --note "3A Monday"
# { "code": "…", "url": "https://…/<code>", … }   — hand the url to students
```

Example — host an image and reference it from the quiz YAML:

```bash
npx @novedu/cli images upload sorting-diagram --file ./diagram.png --credit "CC BY 4.0"
# { "name": "sorting-diagram", "mimeType": "image/png", "byteSize": 48211, "credit": "CC BY 4.0" }
```

```yaml
# in the activity YAML:
image:
  hosted: true
  src: sorting-diagram
  alt: Merge sort splitting an array
```

## Many activities at once: `codes sync`

A course with twenty quizzes should not be twenty `codes create` calls whose
codes you paste into twenty files by hand. Instead, keep an **activity registry**
next to the material: one hand-written YAML file listing every activity under a
stable key, plus a **lock file** the CLI generates and you commit.

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/activities/registry/registry-yaml.schema.json
# ddp-activities.yaml — the registry (you write this)
base-url: "https://raw.githubusercontent.com/acme/course/refs/heads/main/"

activities:
  quizzes:
    welcome:
      file: 0010-introduction/0010-welcome-quiz.yaml
      note: "Creative Coding book: Welcome (0010)"
    number-systems:
      file: 0030-conditions/0050-number-systems-quiz.yaml
      start: 2026-09-01T00:00:00+02:00
      end: 2027-01-31T23:59:59+01:00
  tutors:
    sorting:
      url: https://novedu.at/api/files/sorting-tutor
```

```bash
npx @novedu/cli codes sync ddp-activities.yaml
# ddp-activities.yaml: 3 entries
#   reused    welcome         cu4afwoa23  https://novedu.at/cu4afwoa23
#   minted    number-systems  hb34gpvahn  https://novedu.at/hb34gpvahn
#   reused    sorting         nlc90ezf5z  https://novedu.at/nlc90ezf5z
#
# 2 reused, 1 minted, 0 failed
# Lock file: ddp-activities.lock.yaml
```

```yaml
# ddp-activities.lock.yaml — generated; commit it, do not edit it
activity-codes:
  number-systems: hb34gpvahn
  sorting: nlc90ezf5z
  welcome: cu4afwoa23
```

- **Groups decide the module:** `quizzes`, `tutors`, `writing`, `coding`. Each
  entry gives either `file` (relative to `base-url`, which must end in `/`) or
  an absolute `url`, plus any of `start`/`end` (ISO 8601 **with an offset or
  `Z`**, whole seconds), `note`, and an `llm: {provider, model}` override.
- **Keys are yours and must be unique across all groups** — lowercase letters,
  digits and hyphens. Your material references the key; the lock file maps it to
  the code.
- **Re-runs are safe.** An entry whose activity, window and model override match
  an existing code of yours **reuses** that code; only entries without a match
  are minted. So `codes sync` after every edit is the normal workflow, and the
  first run against already-minted codes should report all-reused.
- **Changing a window or override mints a NEW code.** The old one is not touched
  (it keeps working) and is reported as superseded — delete it in the web app
  when the class has moved on. Changing only the `note` never forks a code.
- `--dry-run` shows what would happen without minting or writing anything;
  `--json` prints the machine-readable report; `--lock <path>` puts the lock file
  somewhere else.
- One broken activity does not stop the run: it is reported as `failed`, the
  other entries still sync, the lock keeps that entry's previous code, and the
  command exits 1.
- **A key keeps its code.** Two keys may point at the same activity on purpose
  (one quiz linked from two chapters, each with its own statistics); they get one
  code each, and neither moves on a later run.
- Unknown extra keys are ignored, so you can annotate entries freely — but an
  entry with nothing under it is an error, not an annotation, because that is
  what a mis-indented entry looks like.
- The `# yaml-language-server:` line on top is optional: it gives editors with
  YAML support field completion, hover help and a warning on a misspelled group
  name. `codes sync` is still the authority — it checks things a schema cannot,
  such as key uniqueness and whether `end` is after `start`.

Publications read the lock file offline. In a Quarto book, for example, add
`metadata-files: [ddp-activities.lock.yaml]` to `_quarto.yml` and let the
shortcode look the key up in `activity-codes` — the book then renders without
ever calling the app.

## Triaging student reports (teacher account required)

Students can flag an AI interaction — a chat or a graded quiz answer — with a
reaction and an optional note. The `reports` group reads and resolves those
flags; same JSON stdout/stderr contract as above.

```
reports list    [--status <open|resolved|all>] [--reaction <good|omg|bad|holysh>]
                [--search <q>] [--all]
reports show    <id>
reports resolve <id...>
```

- `reports list` defaults to **open reports on your own codes** (like the web
  inbox), most urgent first; `--all` widens to every teacher's codes.
- `reports show <id>` prints one report in full. A **chat** report embeds the
  conversation transcript as a `messages` array; a **quiz-answer** report
  already carries its question / answer / feedback snapshot inline.
- `reports resolve <id...>` resolves one or more reports in a single request;
  unknown or already-resolved ids are silently ignored.
- The CLI deliberately cannot file, reopen, or delete a report — those stay in
  the web `/reports` inbox.

The typical loop for turning a report into a better activity:

```bash
npx @novedu/cli reports list --reaction holysh        # find the urgent flags
npx @novedu/cli reports show 3f2c…                    # read the report + transcript
# fix the activity YAML, then check it offline:
npx @novedu/cli validate ./sorting-quiz.yaml --kind quiz
npx @novedu/cli files upload sorting-quiz --file ./sorting-quiz.yaml
npx @novedu/cli reports resolve 3f2c…                 # existing codes already serve the fix
```

## Using the CLI from a coding agent

The app repo ships a Claude Code skill that teaches coding agents the full CLI
workflow — validation, the sign-in hand-off, code/file management, and the
report-triage loop:
[`.claude/skills/novedu-tutor-cli/SKILL.md`](https://github.com/Teaching-HTL-Leonding/novedu-chat-mvp/blob/main/.claude/skills/novedu-tutor-cli/SKILL.md)
(mirrored at `.agents/skills/novedu-tutor-cli/`). Agents working inside that
repo pick it up automatically.

## Development

The CLI lives in the app repo as an npm workspace.

```bash
npm run cli -- validate ./activities/examples/sorting-algorithms/sorting-tutor.yaml   # run from source via tsx
npm run cli:build                                    # bundle to cli/dist via tsdown
npm run test:cli                                     # build + integration tests (local & live URLs)
```

The fast in-process unit tests (`cli/src/commands/*.unit.test.ts`) run in CI;
the integration tests hit the network and are local-only.
