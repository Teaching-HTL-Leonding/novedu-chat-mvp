# @novedu/cli

Command-line companion for the Novedu chat app (installed command: `novedu-cli`).
Today it validates every activity YAML the app accepts — **tutors**, **fragment
libraries**, **quizzes**, **writing activities**, and **coding activities**; more
commands will follow. Validating a tutor also fully validates every fragment library
it references; pass `--kind` to validate any other kind on its own.

It reuses the app's exact validation pipeline (`lib/tutors`, `lib/quiz-validate`,
`lib/writing-validate`, `lib/coding-validate`), so an activity that passes here is
the same one the app would accept — no separate, drifting rules.

## Usage

```bash
# Validate a local file (relative fragment_files resolve from the same folder)
npx @novedu/cli validate ./activities/tutors/simple-tutor.yaml

# Validate a published tutor by URL
npx @novedu/cli validate https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/activities/tutors/simple-tutor.yaml

# Validate a fragment library on its own
npx @novedu/cli validate ./activities/tutors/simple-fragments.yaml --kind fragment

# Validate a quiz, a writing activity, or a coding activity
npx @novedu/cli validate ./activities/quizzes/sample-quiz.yaml --kind quiz
npx @novedu/cli validate ./activities/writings/human-animal-short-story.yaml --kind writing
npx @novedu/cli validate ./activities/coding/beginner-typescript.yaml --kind coding

# Machine-readable output (the raw validation result)
npx @novedu/cli validate ./activities/tutors/simple-tutor.yaml --json
```

`--kind` accepts `tutor` (default), `fragment`, `quiz`, `writing`, or `coding`; it
is caller-declared, not auto-detected.

Exit code is `0` when the activity is valid and `1` when it has errors, so it works
as a pre-commit / CI gate.

## Development

The CLI lives in the app repo as an npm workspace.

```bash
npm run cli -- validate ./activities/tutors/simple-tutor.yaml   # run from source via tsx
npm run cli:build                                    # bundle to cli/dist via tsdown
npm run test:cli                                     # build + integration tests (local & live URLs)
```

The fast in-process unit test (`cli/src/commands/validate.unit.test.ts`) runs in
CI; the integration tests hit the network and are local-only.
