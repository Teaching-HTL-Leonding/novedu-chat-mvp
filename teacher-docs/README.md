# Teacher docs

Teacher-facing documentation for Novedu, the "teacher guide". The Markdown in
`content/` is the **source of truth** and it is human-owned: chapters are edited
directly, by hand or with an agent running the **`novedu-teacher-docs` skill**
(`.agents/skills/novedu-teacher-docs/`), which patches chapters from a git diff
using the "Where to look" column of `CHAPTERS.md` as the map from app area to
chapter.

It's a **teacher handbook**, written independently of whatever consumes it. The
first consumer exists — the Astro Starlight site in `teacher-docs-site/` renders the
corpus (see `docs/teacher-docs.md`) — but the corpus stays site-agnostic: the site
adapts to the conventions here, never the other way round. Aim for correct and
useful; a human reviews each change before it lands, so the odd rough edge is fine
and gets fixed on the next pass.

## Layout

| Path | Owner | What |
| --- | --- | --- |
| `README.md` | human | this orientation |
| `style.md` | human | project voice/reading level |
| `CHAPTERS.md` | human | the chapter manifest = the information architecture |
| `content/` | human | the markdown corpus, the source of truth |
| `assets/` | curated | images (screenshots are curated, not auto-captured, for now) |

## Before you edit a chapter

Read the chapter's entry in **`docs/teacher-docs-notes.md`** — the engineer-side
guardrails: who the chapter's reader is, and the facts that are easy to get wrong.
The editing rules themselves (diff-driven patching, the frontmatter contract, the
scope rule, the writing style) live in the **`novedu-teacher-docs` skill**.

Author in **English only** for now; translation/localization, if ever, is a
downstream concern and not handled here.
