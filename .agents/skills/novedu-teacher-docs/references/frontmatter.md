# Frontmatter contract + generated banner

Every generated chapter in `teacher-docs/content/` opens with YAML frontmatter that
serves two needs at once: **rendering** (a title, a short description, an ordering
hint, what any docs site or renderer wants) and **light categorization** (audience,
keywords).

## The contract

```yaml
---
title: Let students answer with a photo
description: Turn on photo answers in a quiz and see how they are graded.
sidebar:
  order: 3
audience: teacher
keywords: [photo answer, image, quiz, imageInput]
related:
  - 20-building-activities/04-quizzes
  - 30-sharing-activities/03-time-limitation
generated: true
---
```

Field notes:

- **title**: teacher-facing, task-shaped. Not the app's internal noun.
- **description**: one sentence, ≤ ~160 chars. Serves as both a page meta
  description and the snippet a search/assistant layer would rank on, so make it a
  faithful summary, not marketing.
- **sidebar.order**: position within the section; mirrors the chapter's numeric
  prefix. Section grouping comes from the folder. (A common docs-site convention;
  harmless if a given renderer ignores it.)
- **audience**: always `teacher` for this corpus. Present so a future mixed corpus
  can filter.
- **keywords**: the words a teacher would actually search or ask. Useful for any
  search or retrieval layer. Use teacher words first; an internal alias
  (`imageInput`) may follow only if a teacher would plausibly paste it from a
  sample file.
- **related**: other chapters to surface as "next" or related links, as
  content-relative slugs (folder + file without number-stripping or extension, for
  example `10-yaml-for-teachers/01-why-yaml`). The renderer builds the navigation; the
  body carries no "where to go next" links. Optional; omit if there are none.
- **generated**: always `true`. Marks the file as a build artifact.

Glossary terms are marked inline in the body with `[[term]]` (see the style rules),
not listed in frontmatter.

There is deliberately no `sources` or `verified_against` field: which files a chapter
drew on, and when it was last checked, are not tracked in the doc. Staleness is
handled by reasoning over git diffs (see the skill's *Keeping docs current*), and a
chapter's git history is its own "last written" baseline.

## The banner

Immediately after the frontmatter, before the first body content:

```markdown
<!--
  GENERATED FILE, do not edit by hand.
  Edit the chapter prompt in teacher-docs/prompts/… and regenerate.
-->
```

This makes the build-artifact decision social: anyone opening the file sees that
edits belong in the prompt. (An HTML comment is not shown when the markdown is
rendered to a page.)

## Body structure

The body carries **no `#` (h1) heading**: the page title renders from the
frontmatter `title`, so a body `# Title` would show up twice. After the banner, go
straight into the first body content (prose or a `##` section), separated by one
blank line. Body headings start at `##`. (Lines beginning with `# ` inside a fenced
code block are code, not headings, and are fine.)
