---
title: The Novedu CLI and its AI skill
description: What the Novedu command-line companion does for you, and how to install and update the skill that lets your AI assistant use it.
sidebar:
  order: 7
audience: teacher
keywords: [CLI, novedu-cli, command line, AI skill, skills.sh, install, update, assistant]
related:
  - 10-yaml-for-teachers/04-cli-validation
  - 10-yaml-for-teachers/05-see-the-prompt
  - 10-yaml-for-teachers/06-testing-the-grader
  - 30-sharing-activities/01-creating-codes
generated: true
---

<!--
  GENERATED FILE, do not edit by hand.
  Edit the chapter prompt in teacher-docs/prompts/00-introduction/07-novedu-cli.prompt.md and regenerate.
-->

The Novedu CLI is a small companion tool for the app that you run from a terminal. It does two things for you. It checks the activity files you write, and it lets you do your teacher work without opening the website.

Checking comes first, because it saves the most trouble. The CLI runs the very same checks the app runs when it loads your activity, so a missing field or a typo shows up on your screen instead of in front of a class. It can also print the exact instructions your activity sends to the AI model, which is the fastest way to answer "why is the tutor behaving like that?".

The second half is the teacher work: creating a code for an activity, uploading activity files and images to the app, seeing what students have reported, and testing how a quiz grades sample answers. Every one of those has its own chapter later in this guide.

You don't install the CLI permanently. With Node.js (version 22 or newer) on your computer, one command fetches and runs it whenever you need it:

```bash
npx @novedu/cli --help
```

## Why there is an AI skill for it

You don't have to remember any of those commands. Novedu ships a skill, a set of written instructions that teaches an AI coding assistant (such as Claude Code, Codex, or Cursor) how to use the CLI properly: which command answers which question, which options matter, and how to read the error messages.

With the skill installed you work in plain language. You ask "is my quiz valid?" or "show me the grading prompt for question 3" or "create a code for this tutor", and the assistant picks the right command, runs it, and explains the result. That is a real difference for teachers who don't enjoy the terminal: you describe what you want, not how to get it.

Installing the skill does not install the CLI as part of your project. The skill is instructions only. When your assistant needs the CLI, it fetches it on demand with `npx`, exactly as in the command above.

## Install the skill

The skill is installed with [skills.sh](https://skills.sh), a small tool for managing agent skills. Open a terminal in the folder where you keep your course material and run:

```bash
npx --yes skills@latest add Teaching-HTL-Leonding/novedu-chat-mvp \
  --skill novedu-tutor-cli \
  --agent claude-code \
  --yes
```

What the parts do:

- `Teaching-HTL-Leonding/novedu-chat-mvp` is the public Novedu repository the skill comes from. No sign-in needed.
- `--skill novedu-tutor-cli` picks exactly this one skill. The repository contains several, and you only want the one about the CLI.
- `--agent claude-code` says which assistant to install it for. Replace `claude-code` with `codex`, `cursor`, `github-copilot`, or whichever assistant you use. Naming it is safer than letting the tool guess.
- The first `--yes` tells `npx` to fetch the skills tool without asking. The final `--yes` skips the skills tool's own questions.
- `skills@latest` makes sure you get the current version of the skills tool and not an old copy from your computer's cache.

The command installs into the folder you are in, which is what you want: the skill sits next to your course material, so anyone you share the folder with gets it too. Don't add `--global`. A global install lives on your own machine only and your colleagues won't have it.

Afterwards you will find the skill's own folder (the exact place depends on your assistant) and a `skills-lock.json` file that records where the skill came from. If your course material is in Git, commit both, not just the lock file.

Start a fresh session with your assistant after installing, so it picks up the new skill.

## Check that it worked

Ask the skills tool what it has installed for your assistant:

```bash
npx --yes skills@latest list --agent claude-code
```

`novedu-tutor-cli` should appear in the list. The real test is easier: ask your assistant something like "validate my quiz with the Novedu CLI" and see whether it reaches for the right command.

## Update the skill

Novedu changes often, and the skill changes with it. From the same folder, update just this skill:

```bash
npx --yes skills@latest update novedu-tutor-cli --project --yes
```

Naming `novedu-tutor-cli` keeps the update to that one skill instead of everything you have installed. `--project` keeps it in your course material folder rather than updating a copy somewhere on your machine. To update all the skills in the folder on purpose, leave the name out:

```bash
npx --yes skills@latest update --project --yes
```

If your course material is in Git, look at what changed before you commit it, the same way you would review any other incoming change.

## Leave the installed skill as it is

Treat the installed skill as delivered material, like a textbook you received rather than one you write in. Don't edit the files by hand: the next update replaces them, and your changes disappear. If you want your assistant to follow extra rules of your own, put those in a separate skill or in your project's own instructions file, where an update can't overwrite them.
