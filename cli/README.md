# @novedu/cli

Command-line companion for the Novedu chat app (installed command: `novedu-cli`).
Today it validates **tutor YAML** definitions and **fragment libraries**; more
commands will follow. Validating a tutor also fully validates every fragment
library it references; pass `--kind fragment` to validate a fragment library on
its own.

It reuses the app's exact validation pipeline (`lib/tutors`), so a tutor that
passes here is the same tutor the app would accept — no separate, drifting rules.

## Usage

```bash
# Validate a local file (relative fragment_files resolve from the same folder)
npx @novedu/cli validate ./tutors/simple-tutor.yaml

# Validate a published tutor by URL
npx @novedu/cli validate https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/tutors/simple-tutor.yaml

# Validate a fragment library on its own
npx @novedu/cli validate ./tutors/simple-fragments.yaml --kind fragment

# Machine-readable output (the raw validation result)
npx @novedu/cli validate ./tutors/simple-tutor.yaml --json
```

`--kind` defaults to `tutor`; it is caller-declared, not auto-detected.

Exit code is `0` when the tutor is valid and `1` when it has errors, so it works
as a pre-commit / CI gate.

## Development

The CLI lives in the app repo as an npm workspace.

```bash
npm run cli -- validate ./tutors/simple-tutor.yaml   # run from source via tsx
npm run cli:build                                    # bundle to cli/dist via tsdown
npm run test:cli                                     # build + integration tests (local & live URLs)
```

The fast in-process unit test (`cli/src/commands/validate.unit.test.ts`) runs in
CI; the integration tests hit the network and are local-only.
