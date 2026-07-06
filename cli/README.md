# @novedu/cli

Command-line companion for the Novedu chat app (installed command: `novedu-cli`;
requires Node >= 20). It validates every activity YAML the app accepts — **tutors**,
**fragment libraries**, **quizzes**, **writing activities**, and **coding
activities** — and signs in to Microsoft Entra ID (`login` / `logout` / `whoami`)
to call the app's protected APIs; more commands will follow. Validating a tutor
also fully validates every fragment library it references; pass `--kind` to
validate any other kind on its own.

It reuses the app's exact validation pipeline (`lib/tutors`, `lib/quiz-validate`,
`lib/writing-validate`, `lib/coding-validate`), so an activity that passes here is
the same one the app would accept — no separate, drifting rules.

## Usage

```bash
# Validate a local file (relative fragment_files resolve against the file's location)
npx @novedu/cli validate ./activities/examples/sorting-algorithms/sorting-tutor.yaml

# Validate a published tutor by URL
npx @novedu/cli validate https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/activities/examples/sorting-algorithms/sorting-tutor.yaml

# Validate a fragment library on its own
npx @novedu/cli validate ./activities/examples/shared/general-fragments.yaml --kind fragment

# Validate a quiz, a writing activity, or a coding activity
npx @novedu/cli validate ./activities/examples/sorting-algorithms/sorting-quiz.yaml --kind quiz
npx @novedu/cli validate ./activities/examples/review-writing/restaurant-review-letter.yaml --kind writing
npx @novedu/cli validate ./activities/examples/sorting-algorithms/sorting-visualizer.yaml --kind coding

# Machine-readable output (the raw validation result)
npx @novedu/cli validate ./activities/examples/sorting-algorithms/sorting-tutor.yaml --json
```

`--kind` accepts `tutor` (default), `fragment`, `quiz`, `writing`, or `coding`; it
is caller-declared, not auto-detected.

Exit code is `0` when the activity is valid and `1` when it has errors, so it works
as a pre-commit / CI gate.

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
- The server defaults to the production app; override per command with
  `--server <url>` or the `NOVEDU_SERVER` env var (e.g.
  `http://localhost:3000` for development). Other deployments of the app can
  point the CLI at their own tenant/app registration via `NOVEDU_TENANT_ID` /
  `NOVEDU_CLIENT_ID`.
- Not signed in (or the cached token expired for good)? Commands exit 1 with
  `Not signed in — run "novedu-cli login".`

## Development

The CLI lives in the app repo as an npm workspace.

```bash
npm run cli -- validate ./activities/examples/sorting-algorithms/sorting-tutor.yaml   # run from source via tsx
npm run cli:build                                    # bundle to cli/dist via tsdown
npm run test:cli                                     # build + integration tests (local & live URLs)
```

The fast in-process unit test (`cli/src/commands/validate.unit.test.ts`) runs in
CI; the integration tests hit the network and are local-only.
