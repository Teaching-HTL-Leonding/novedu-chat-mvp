---
name: novedu-tutor-cli
description: >-
  Validate a Novedu tutor YAML with the `novedu-tutor` CLI, which runs the exact
  same checks the app enforces (YAML parse, tutor + fragment-file schema,
  cross-reference and variable consistency, system-prompt assembly). Use this
  skill whenever the user wants to validate, check, lint, or verify a tutor YAML
  or tutor definition, debug tutor schema errors, sanity-check fragment files or
  `tutor_instructions`/`fragment_files`, or confirm a tutor is correct before
  committing or publishing it -- even if they don't name the CLI.

  Reach for it on phrasings like "is this tutor valid?", "check my tutor.yaml",
  "why won't this tutor load?", "did I break the fragments?", or any request to
  verify a tutor authored for the Novedu chat app. Prefer this CLI over reading
  the YAML by eye or re-deriving the rules -- the CLI is the source of truth and
  reports precise error codes you can act on.
---

# Validating tutor YAML with `novedu-tutor`

`novedu-tutor` is the command-line companion for the Novedu chat app. Its first
command, `validate`, takes a tutor YAML (a local file or a public URL) and runs
the **same** validation pipeline the app uses: parse YAML → schema-check the
tutor and every referenced fragment file → check that fragment references and
their variables line up → assemble the final system prompt. If all of that
succeeds the tutor is valid.

A tutor that passes here is the same tutor the app will accept — so this is the
authoritative way to check one, not a re-implementation to second-guess.

- **Exit code `0`** = valid, **`1`** = errors found. That makes it usable as a
  pre-commit / CI gate.
- `validate` is the only command today; the CLI is built to grow, so check
  `--help` if a task sounds like it might be covered by a newer command.

## Pick the right invocation: inside the repo vs. outside

The command differs depending on **where you are**. Decide first:

**Inside the app repo** — the working directory is the chat-prototype /
`novedu-chat-mvp` repository (tell-tale signs: the root `package.json` has
`"name": "chat-prototype"` and a `cli/` workspace; the tutor fixtures live in
`tutors/`). Run it straight from source, no build or install needed:

```bash
npm run cli -- validate <pathOrUrl> [--json]
```

Use this form in the repo because it runs the live workspace code, so it reflects
any local edits to the validation core (`lib/tutors`) — and there's nothing to
install. (The `--` passes the rest of the arguments through to the CLI.)

**Outside the repo** — any other folder, e.g. a teacher authoring tutors in their
own directory. Use the published package via `npx`:

```bash
npx novedu-tutor validate <pathOrUrl> [--json]
```

> Note: the `npx` form works once `novedu-tutor` is published to npm. If `npx`
> reports the package can't be found, it isn't published yet — fall back to
> running it from a clone of the repo with `npm run cli -- validate …`.

**How to decide:** if the current directory (or the file you're validating) is
inside the app repo, use `npm run cli`; otherwise use `npx novedu-tutor`. When
unsure, a quick check for a root `package.json` named `chat-prototype` settles it.

## The `validate` command

```
validate <pathOrUrl> [--json]
```

- **`<pathOrUrl>`** — either a **local file path** (e.g. `./tutors/my-tutor.yaml`)
  or a public **http(s) URL** (e.g. a raw GitHub link to a tutor YAML).
- **Relative `fragment_files`** in the tutor resolve against the tutor's own
  location: a sibling file for a local tutor, a sibling URL for a remote one. So
  validate the tutor where its fragment files actually sit.
- **`--json`** — print the raw result object instead of the formatted report.
  Use this when you need to inspect specifics programmatically (drill into the
  exact failing variable, feed CI, etc.). Without it you get a human-readable
  pass/fail summary with the model, prompt size, and any warnings.

## Reading the result

The report separates **errors** (the tutor is invalid — must fix) from
**warnings** (it still builds, but something is worth a look). On failure, act on
the specific error code rather than just relaying it:

| Code | Meaning |
| --- | --- |
| `YAML_PARSE_ERROR` | The file isn't valid YAML (indentation, syntax). |
| `TUTOR_SCHEMA_ERROR` | The tutor's fields are wrong/missing (often a typo'd key — the schema is strict). |
| `FRAGMENT_FILE_SCHEMA_ERROR` | A referenced fragment file has invalid structure. |
| `FRAGMENT_NOT_FOUND` | The tutor references a fragment id that doesn't exist in the file. |
| `MISSING_REQUIRED_VARIABLE` | A fragment needs a variable the tutor didn't supply. |
| `VARIABLE_TYPE_MISMATCH` | A supplied variable is the wrong type for what the fragment declares. |
| `FETCH_FAILED` | A file/URL couldn't be read (missing local file, bad URL, network). |

For the full set, the codes come from `lib/tutors/errors.ts` in the repo. When a
schema error is vague, re-run with `--json` to see the underlying issue detail.

## Scope — what this CLI does NOT do

It only **validates**. It does not authenticate, create or delete tutor codes,
deploy, or talk to the running app. Don't offer those via this CLI; validation
needs no login and touches no protected resource.

## Examples

Inside the repo, a known-good fixture:

```bash
npm run cli -- validate tutors/simple-tutor.yaml
# ✔ Valid tutor — tutors/simple-tutor.yaml   (exit 0)
```

Inside the repo, a broken tutor — exit 1, with actionable codes:

```bash
npm run cli -- validate tutors/broken-tutor.yaml
# ✘ Invalid tutor … MISSING_REQUIRED_VARIABLE / FRAGMENT_NOT_FOUND   (exit 1)
```

Outside the repo, validating a published tutor by URL:

```bash
npx novedu-tutor validate https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/tutors/simple-tutor.yaml
```

Machine-readable output for scripting/CI:

```bash
npx novedu-tutor validate ./my-tutor.yaml --json
```
