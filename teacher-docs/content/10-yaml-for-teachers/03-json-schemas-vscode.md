---
title: JSON schemas in your editor
description: Set up VS Code so it suggests fields, underlines mistakes, and shows help while you write an activity file.
sidebar:
  order: 3
audience: teacher
keywords: [VS Code, YAML extension, Red Hat, schema, autocomplete, error checking, yaml-language-server]
related:
  - 10-yaml-for-teachers/01-why-yaml
  - 10-yaml-for-teachers/02-yaml-101
  - 10-yaml-for-teachers/04-cli-validation
generated: true
---

<!--
  GENERATED FILE, do not edit by hand.
  Edit the chapter prompt in teacher-docs/prompts/10-yaml-for-teachers/03-json-schemas-vscode.prompt.md and regenerate.
-->

Writing an [[activity]] file by hand is much easier when your editor knows which fields exist. A short one-time setup gives you suggestions as you type, warnings when something is wrong, and a short explanation of every field, all before you upload anything to Novedu.

## What the editor gives you

With schema support switched on, your editor helps you in three ways:

- **Suggestions as you type.** Start typing at the top level of the file and the editor offers the field names that belong there, so you don't have to remember them.
- **Red underlines for mistakes.** A misspelt field name, or a value of the wrong type (for example, plain text where a list is expected), gets underlined right away.
- **Help on hover.** Move the mouse over a field name and the editor shows a short description of what the field does.

## Install the YAML extension (one time)

Schema support comes from the free YAML extension by Red Hat. You install it once; after that it works for every activity file you open.

1. Open VS Code.
2. Open the **Extensions** view (Ctrl+Shift+X).
3. Search for **YAML** and select the extension published by **Red Hat**.
4. Select **Install**.

You can also install it from the [Red Hat YAML extension page on the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml).

## Add the schema line to your file

The editor learns which fields your file may contain from a special comment on the first line of the file. For a tutor, the sample activities start like this:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/activities/tutors/tutor-yaml.schema.json
```

Copy the line exactly as it is, including the leading `#`. It is a comment, not a field: Novedu ignores it completely, and students never see it. Only your editor reads it, fetches the schema from that address over the internet, and switches on the suggestions, underlines, and hover help. The easiest way to get the line right is to start from one of the sample activities, which all carry it already.

## Which schema for which kind of activity

There is one schema per kind of activity, and the line has to match the kind of file you are writing. With the wrong schema, the editor underlines fields that are perfectly valid, so if everything suddenly looks wrong, check the first line first.

For a tutor, or a library of [[fragment|fragments]] (the same schema covers both):

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/activities/tutors/tutor-yaml.schema.json
```

For a quiz:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/activities/quizzes/quiz-yaml.schema.json
```

For a writing activity:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/activities/writings/writing-yaml.schema.json
```

For a coding activity:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/Teaching-HTL-Leonding/novedu-chat-mvp/refs/heads/main/activities/coding/coding-yaml.schema.json
```

## The editor helps, Novedu decides

Schema support in the editor is a comfort feature: it catches most typos while you write. Novedu still runs its own, stricter checks when you save a file, and those checks are the ones that count. A file with no red underlines can still be rejected (for example, when a tutor refers to a fragment that doesn't exist), so treat the editor's hints as a first pass, not as final approval.
