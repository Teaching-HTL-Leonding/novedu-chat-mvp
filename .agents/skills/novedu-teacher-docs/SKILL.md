---
name: novedu-teacher-docs
description: >-
  Generate and maintain Novedu's teacher-facing documentation, the "teacher
  guide" / end-user docs under teacher-docs/, from the app's source code and the
  engineer docs in docs/. Use this skill whenever the user wants to create,
  regenerate, or update a teacher-docs chapter from its prompt; refresh the docs
  after a feature change; or verify docs against their sources. Trigger it even when
  the user does not name the skill, 
  e.g. "update the teacher guide for photo answers", "the CLI login docs are
  stale", "add a chapter about time-limiting a code", or "regenerate the quizzes
  overview". Do NOT use it for engineer-facing docs (docs/**) or for authoring
  activity YAML, that's the novedu-tutor-cli skill.
---

# Authoring Novedu teacher docs

Teacher docs are **generated from source**, not hand-written. The durable,
human-owned artifact is the **chapter prompt**; the markdown in
`teacher-docs/content/` is a **regenerable build artifact**. When something is
wrong in a chapter, fix the prompt and regenerate, do not hand-edit the output.

## The model

```
doc = f(chapter-prompt, source code, engineer docs)
```

- **chapter prompt** (`teacher-docs/prompts/**/*.prompt.md`), human-owned IP: what
  one chapter should cover, plus anything to watch out for. Its shape is the author's
  choice and varies from topic to topic; this skill imposes no template and does not
  help write prompts. Two things hold whatever the shape: keep prompts **durable**
  (they should not pin source file paths, which rot when code moves), and treat the
  prompt as the thing you edit when a chapter is wrong (not the generated output).
- **sources**: the app's own code and the engineer docs in `docs/` and
  `activities/**/README.md`. Ground truth. You **discover** the current, relevant
  ones yourself (start from the areas the prompt hints at, follow renames) and state
  as fact only what they support.
- **content** (`teacher-docs/content/**/*.md`), generated. Every file carries a
  "generated, edit the prompt" banner (see `references/frontmatter.md`).

## Repo layout

```
teacher-docs/
  README.md            orientation + the "edit the prompt, not the output" policy
  style.md             human-owned: voice, reading level, audience  → references/style-and-voice.md is the rulebook
  CHAPTERS.md          the chapter manifest = the information architecture
  prompts/             human-owned IP: one *.prompt.md per chapter
  content/             GENERATED markdown (do not hand-edit)
  assets/              GENERATED / curated images (see screenshots note below)
```

The skill (`.agents/skills/novedu-teacher-docs/`) holds the reusable *how*; the
`teacher-docs/` folder holds the project-specific *what*.

## Where the sources live

Durable, folder-level orientation for discovery, never pin exact file paths in a
prompt; search these areas for the current files instead.

- `activities/**/README.md`, the **teacher-facing authoring guides** (one per
  module). Usually the best, safest ground truth: already written for teachers.
- `activities/examples/**`, real, validated sample activities. Quote these for YAML.
- `docs/**`, **engineer** references. Accurate for *behavior*; use only the
  teacher-visible behavior (see `references/scope.md`).
- `cli/README.md` and the `novedu-tutor-cli` skill, the CLI and its validation.
- `README.md` (root), product overview and framing.
- app source (`app/`, `lib/`), last resort, when a guide doesn't cover a detail.
  Prefer the guides; source moves and renames (e.g. `lib/tutors` → `lib/prompt-fragments`).

## Two modes

A chapter is generated in one of two modes.

- **Cold generate**: no output yet, or a deliberate rebuild. Read the prompt,
  discover and read its sources, write the chapter from scratch, emit the
  frontmatter + banner.
- **Incremental patch**: the chapter exists and a code change may have affected it.
  Do **not** rewrite from a blank page, that produces noisy, unreviewable diffs.
  Feed the generator the *current* chapter plus the relevant **git diff**, and ask
  for the smallest change that makes the chapter correct again.

## Keeping docs current

Which chapters a code change affects is decided by **reasoning over the git diff**. Given a diff (a
PR, or a range since the docs were last refreshed), read it and judge which chapters
a change plausibly touches, using `teacher-docs/CHAPTERS.md` as the map from app area
to chapter; then run an incremental patch on each. A chapter's own git history is the
baseline for "what changed since this was last written".

## Per-chapter workflow

Run this for one chapter at a time.

1. **Read the prompt** in `teacher-docs/prompts/`. It tells you what the chapter
   should cover and anything to be careful about. Prompts vary in shape from topic to
   topic, so take direction from what this one actually says rather than expecting
   fixed sections or a source list.
2. **Discover and read the sources**: search the repo for the current,
   relevant files (start from the prompt's hints and the areas in the layout below;
   follow renames). Read them in full, not from memory; assert as fact only what
   they support.
3. **Keep it teacher-facing** (`references/scope.md`). Describe what a teacher does
   and sees, not how the app works inside. Not for secrecy (the code is open source),
   but because internals are off-topic and drift when code changes.
4. **Draft** the chapter in the teacher voice (`references/style-and-voice.md`),
   following the prompt's outline. Screenshots are placeholders + alt text for now
   (see below).
5. **Sanity-check your claims** against what you read, especially the prompt's
   "facts that are easy to get wrong". Fix what doesn't check out; where you're
   unsure, flag it for the reviewer rather than stating it confidently. You don't
   need to prove every sentence, just don't assert things you have reason to doubt.
6. **Emit frontmatter + banner** per `references/frontmatter.md`.

## Language

Author in **English only** for now.

## References

- `references/style-and-voice.md`: the hard writing constraints (no em-dashes, no AI slang, self-contained sections) plus voice, word choice, and mechanics, adapted from the Microsoft Writing Style Guide for a small teacher handbook.
- `references/scope.md`: stay at the teacher's level, describe behavior, not internals (read before writing).
- `references/frontmatter.md`: the frontmatter contract and the generated banner.
