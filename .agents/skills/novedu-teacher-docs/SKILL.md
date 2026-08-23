---
name: novedu-teacher-docs
description: >-
  Maintain and update Novedu's teacher-facing documentation, the "teacher
  guide" / end-user docs under teacher-docs/content/. Use this skill whenever the
  user wants to patch a chapter after a feature change, write a new chapter, or
  verify chapters against the code. Trigger it even when the user does not name
  the skill,
  e.g. "update the teacher guide for photo answers", "the CLI login docs are
  stale", "add a chapter about time-limiting a code", or "refresh the quizzes
  chapter". Do NOT use it for engineer-facing docs (docs/**) or for authoring
  activity YAML, that's the novedu-tutor-cli skill.
---

# Authoring Novedu teacher docs

Teacher docs are **human-owned and hand-maintained**. The Markdown in
`teacher-docs/content/` is the **source of truth**; this skill's job is to keep it
correct, current, and in voice. When something is wrong in a chapter, edit the
chapter.

## The model

You work from three inputs.

- **the current chapter** (`teacher-docs/content/**/*.md`): what the guide says
  today. It is the baseline you patch, never a draft you throw away.
- **the change**: the relevant **git diff** plus the **sources** it points at, the
  app's own code and the engineer docs in `docs/` and `activities/**/README.md`.
  Ground truth. You **discover** the current, relevant ones yourself (start from the
  areas the chapter and its notes hint at, follow renames) and state as fact only
  what they support.
- **the chapter's entry in `docs/teacher-docs-notes.md`**: the engineer-side
  guardrails for that chapter, who its reader is and what job they came to do, plus
  the facts that are easy to get wrong. Its shape is the author's choice and varies
  from topic to topic; this skill imposes no template. One thing holds whatever the
  shape: keep notes **durable**, they should not pin source file paths, which rot
  when code moves.

## Repo layout

```
teacher-docs/
  README.md            orientation for the corpus
  style.md             human-owned: voice, reading level, audience  → references/style-and-voice.md is the rulebook
  CHAPTERS.md          the chapter manifest = the information architecture
  content/             human-owned markdown, the source of truth
  assets/              curated images (see screenshots note below)
docs/
  teacher-docs-notes.md  per-chapter guardrails: reader job + facts easy to get wrong
```

The skill (`.agents/skills/novedu-teacher-docs/`) holds the reusable *how*; the
`teacher-docs/` folder holds the project-specific *what*.

A **new section directory** under `content/` takes two declarations: a `## NN:`
block in `teacher-docs/CHAPTERS.md` and a one-line entry in the docs site's
section list (`teacher-docs-site/src/lib/sections.ts`). The site build fails
loudly on an undeclared section, so a missing declaration cannot ship silently.

## Where the sources live

Durable, folder-level orientation for discovery, never pin exact file paths in a
notes entry; search these areas for the current files instead.

- `activities/**/README.md`, the **teacher-facing authoring guides** (one per
  module). Usually the best, safest ground truth: already written for teachers.
- `activities/examples/**`, real, validated sample activities. Quote these for YAML.
- `docs/**`, **engineer** references. Accurate for *behavior*; use only the
  teacher-visible behavior (see `references/scope.md`).
- `cli/README.md` and the `novedu-tutor-cli` skill, the CLI and its validation.
- `README.md` (root), product overview and framing.
- app source (`app/`, `lib/`), last resort, when a guide doesn't cover a detail.
  Prefer the guides; source moves and renames (e.g. `lib/tutors` → `lib/prompt-fragments`).

## The normal mode: incremental patch

Almost every job is a patch. The chapter exists and a code change may have affected
it: work from the *current* chapter plus the relevant **git diff**, and make the
smallest change that makes the chapter correct again. Do **not** rewrite from a
blank page, that produces noisy, unreviewable diffs.

The other case is a **brand-new chapter**, when `CHAPTERS.md` calls for one that
does not exist yet. Start from its row in `CHAPTERS.md`, write its entry in
`docs/teacher-docs-notes.md` (reader job + facts easy to get wrong), discover and
read the sources, then write the chapter.

## Keeping docs current

Which chapters a code change affects is decided by **reasoning over the git diff**. Given a diff (a
PR, or a range since the docs were last refreshed), read it and judge which chapters
a change plausibly touches, using `teacher-docs/CHAPTERS.md` as the map from app area
to chapter; then run an incremental patch on each. A chapter's own git history is the
baseline for "what changed since this was last written".

## Per-chapter workflow

Run this for one chapter at a time.

1. **Read the chapter's entry in `docs/teacher-docs-notes.md`**. It tells you who
   the chapter's reader is and anything to be careful about. Entries vary in shape
   from topic to topic, so take direction from what this one actually says rather
   than expecting fixed sections or a source list. Writing a new chapter? Add its
   entry first.
2. **Discover and read the sources**: search the repo for the current,
   relevant files (start from the notes' hints and the areas in the layout below;
   follow renames). Read them in full, not from memory; assert as fact only what
   they support.
3. **Keep it teacher-facing** (`references/scope.md`). Describe what a teacher does
   and sees, not how the app works inside. Not for secrecy (the code is open source),
   but because internals are off-topic and drift when code changes.
4. **Draft** the chapter in the teacher voice (`references/style-and-voice.md`),
   following the chapter's outline. Screenshots are placeholders + alt text for now
   (see below).
5. **Sanity-check your claims** against what you read, especially the notes entry's
   "facts that are easy to get wrong". Fix what doesn't check out; where you're
   unsure, flag it for the reviewer rather than stating it confidently. You don't
   need to prove every sentence, just don't assert things you have reason to doubt.
6. **Emit frontmatter** per `references/frontmatter.md`.

## Language

Author in **English only** for now.

## References

- `references/style-and-voice.md`: the hard writing constraints (no em-dashes, no AI slang, self-contained sections) plus voice, word choice, and mechanics, adapted from the Microsoft Writing Style Guide for a small teacher handbook.
- `references/scope.md`: stay at the teacher's level, describe behavior, not internals (read before writing).
- `references/frontmatter.md`: the frontmatter contract.
