# Teacher docs

Teacher-facing documentation for Novedu, the "teacher guide". It is **generated
from the app's source code and engineer docs**, not written by hand.

> **doc = f(chapter-prompt, source code, engineer docs)**

The durable, human-owned artifact is the **chapter prompt** in `prompts/`. The
markdown in `content/` is a **regenerable build artifact**. To fix a chapter, edit
its prompt and regenerate, do not hand-edit the output (every generated file says
so in a banner).

It's a **teacher handbook**, written independently of whatever consumes it. The
first consumer exists — the Astro Starlight site in `teacher-docs-site/` renders the
corpus (see `docs/teacher-docs.md`) — but the corpus stays site-agnostic: the site
adapts to the conventions here, never the other way round. Aim for correct and
useful; a human reviews each change before it lands, so the odd rough edge is fine
and gets fixed on the next regeneration.

## Layout

| Path | Owner | What |
| --- | --- | --- |
| `prompts/` | human | one `*.prompt.md` per chapter, the real IP |
| `CHAPTERS.md` | human | the chapter manifest = the information architecture |
| `style.md` | human | project voice/reading level |
| `glossary.md` | human | teacher-word → app-word map |
| `content/` | generated | the markdown corpus (do not hand-edit) |
| `assets/` | generated/curated | images (screenshots are curated, not auto-captured, for now) |

## How generation works

The authoring rules, the two generation modes (cold generate vs. diff-driven
patch), the frontmatter contract, the scope rule, and the writing style, live in the
**`novedu-teacher-docs` skill** (`.agents/skills/novedu-teacher-docs/`). An agent
generating or updating a chapter loads that skill and follows one chapter prompt at a
time.

Author in **English only** for now; translation/localization, if ever, is a
downstream concern and not handled here.
