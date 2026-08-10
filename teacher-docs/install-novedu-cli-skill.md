# Install and update the `novedu-tutor-cli` skill

Research and command verification performed on 2026-08-10.

## What is being installed

The source skill is
[`novedu-tutor-cli`](https://github.com/Teaching-HTL-Leonding/novedu-chat-mvp/blob/main/.agents/skills/novedu-tutor-cli/SKILL.md)
in the public
[`Teaching-HTL-Leonding/novedu-chat-mvp`](https://github.com/Teaching-HTL-Leonding/novedu-chat-mvp)
repository. Its source directory contains `SKILL.md` plus a `references/`
directory of per-command deep dives that `SKILL.md` links to. The skills CLI
recognizes it because `.agents/skills/` is one of its standard skill discovery
locations.

Installing the skill gives Codex instructions for using Novedu's CLI. It does
**not** add `@novedu/cli` as a dependency of this project. When the skill is
used outside the Novedu app repository, its instructions invoke the actual CLI
on demand with `npx @novedu/cli ...`.

## Install it in this project

Run this command from the root of this repository:

```bash
npx --yes skills@latest add Teaching-HTL-Leonding/novedu-chat-mvp \
  --skill novedu-tutor-cli \
  --agent codex \
  --yes
```

Why these arguments are explicit:

- Project scope is the skills CLI's default because `--global` is absent.
- `--skill novedu-tutor-cli` selects only this skill from the upstream
  repository. The repository currently exposes three skills to the CLI.
- `--agent codex` avoids relying on agent auto-detection.
- The first `--yes` belongs to `npx`; the final `--yes` suppresses interactive
  prompts from the skills CLI.
- `skills@latest` avoids using a stale cached release of the skills CLI.

The result is:

```text
.agents/skills/novedu-tutor-cli/SKILL.md
.agents/skills/novedu-tutor-cli/references/*.md
skills-lock.json
```

The command copies the skill into Codex's project path and adds a
`novedu-tutor-cli` entry to the existing `skills-lock.json`. It should preserve
the other entries already in that file.

Review and commit both the installed directory and the lock file:

```bash
git diff -- .agents/skills/novedu-tutor-cli skills-lock.json
git add .agents/skills/novedu-tutor-cli skills-lock.json
```

Do not use `--global` for this use case. A global install would belong to one
developer rather than to this course repository and would not be shared with
the team. Project-installed skill files are meant to be committed. Start a new
Codex session after installation so the newly installed skill is discovered.

## Verify the installation

```bash
npx --yes skills@latest list --agent codex
```

The output should include `novedu-tutor-cli`. It is also reasonable to verify
the two tracked artifacts directly:

```bash
test -f .agents/skills/novedu-tutor-cli/SKILL.md
rg 'novedu-tutor-cli' skills-lock.json
```

## Update it later

From this repository's root, update only this project skill:

```bash
npx --yes skills@latest update novedu-tutor-cli --project --yes
```

`--project` prevents an accidental global-scope update. Naming the skill avoids
updating every project skill. To intentionally update all project skills, use:

```bash
npx --yes skills@latest update --project --yes
```

After an update, inspect the upstream changes before committing them:

```bash
git diff -- .agents/skills/novedu-tutor-cli skills-lock.json
```

Treat the installed skill directory as vendor-managed. Local edits can be
replaced by a later update and also make it harder to review upstream changes.
If this project needs permanent custom instructions, keep them in a separate
project-owned skill or maintain a deliberate fork.

Commit the installed skill itself, not just `skills-lock.json`. The lock file
records the source and content hash used for update tracking, but it should not
be treated as the only bootstrap manifest. If the installed directory is ever
missing, rerun the `add` command above.

## Useful inspection commands

List the skills exposed by the upstream repository without installing them:

```bash
npx --yes skills@latest add Teaching-HTL-Leonding/novedu-chat-mvp --list
```

Opt out of the skills CLI's anonymous telemetry for an individual command if
desired:

```bash
DISABLE_TELEMETRY=1 npx --yes skills@latest update novedu-tutor-cli --project --yes
```

## Sources

- [skills.sh CLI reference](https://skills.sh/docs/cli)
- [skills.sh instructions for Codex](https://skills.sh/agent/codex)
- [The skills CLI README and complete command reference](https://github.com/vercel-labs/skills#readme)
- [Upstream `novedu-tutor-cli` skill](https://github.com/Teaching-HTL-Leonding/novedu-chat-mvp/blob/main/.agents/skills/novedu-tutor-cli/SKILL.md)

The skill did not need a skills.sh catalog page for installation: the skills
CLI successfully discovered it directly from the public GitHub repository.
