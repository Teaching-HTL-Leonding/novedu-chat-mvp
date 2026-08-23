# Teacher docs

Teacher-facing documentation for Novedu, the "teacher guide", plus the Astro
Starlight site that renders it. The Markdown in `src/content/docs/` is the
**source of truth** and it is human-owned: chapters are edited directly, by hand
or with an agent running the **`novedu-teacher-docs` skill**
(`.agents/skills/novedu-teacher-docs/`), which patches chapters from a git diff
using the "Where to look" column of `CHAPTERS.md` as the map from app area to
chapter.

The chapters are a **teacher handbook**, written independently of whatever
consumes them: plain, renderer-agnostic Markdown. The site adapts to the
conventions here, never the other way round. Aim for correct and useful; a human
reviews each change before it lands, so the odd rough edge is fine and gets fixed
on the next pass.

The site ships **publicly at `/docs` inside the Novedu web app**: the Docker image
build compiles it (Astro `base: '/docs'`) and stages `dist/` into the app's
`public/docs/`; `proxy.ts` deliberately excludes the prefix from the Entra gate.
See `docs/teacher-docs.md` for the full serving + CI/CD mechanics.

## Layout

| Path | Owner | What |
| --- | --- | --- |
| `README.md` | human | this orientation |
| `style.md` | human | project voice/reading level |
| `CHAPTERS.md` | human | the chapter manifest = the information architecture |
| `src/content/docs/` | human | the markdown corpus, the source of truth |
| `assets/` | curated | images (screenshots are curated, not auto-captured, for now) |
| `src/`, `scripts/`, `astro.config.mjs` | app | the Astro Starlight site that renders the corpus and ships publicly at `/docs` |

## Before you edit a chapter

Read the chapter's entry in **`docs/teacher-docs-notes.md`** — the engineer-side
guardrails: who the chapter's reader is, and the facts that are easy to get wrong.
The editing rules themselves (diff-driven patching, the frontmatter contract, the
scope rule, the writing style) live in the **`novedu-teacher-docs` skill**.

## Commands (from the repo root)

```bash
npm run docs:dev       # dev server, http://localhost:4321/docs/
npm run docs:build     # static build to teacher-docs/dist/
npm run docs:preview   # serve the build output
npm run docs:stage     # build + copy into public/docs so next dev/start serve /docs
npm run typecheck      # includes this workspace's `astro check` leg
```

The build doubles as the corpus's consistency check: frontmatter schema validation,
dead `related:` slugs (build failure), and a post-build output check
(`scripts/verify-dist.mjs`).

## How it hangs together

- `src/content.config.ts` — the `docs` collection reads `src/content/docs`, where
  the chapters live. The schema extends Starlight's with the corpus's fields
  (`audience`, `keywords`, `related`).
- `src/lib/` — the base-path helper (`paths.ts`) and the corpus contract test.
- `src/components/MarkdownContent.astro` — appends the "Related chapters" link
  cards from the frontmatter `related:` slugs; a dead slug fails the build.
- `src/lib/sections.ts` — the guide's sections in reading order, mirroring
  `CHAPTERS.md`. Both the Starlight sidebar and the llms.txt table of contents
  derive from it, so they cannot drift; a corpus directory missing from the list
  fails the build instead of quietly disappearing from either.
- `src/pages/llms.txt.ts`, `llms-full.txt.ts`, `[...slug].md.ts` + `src/lib/llms.ts`
  — the [llms.txt](https://llmstxt.org) surface for AI agents, built from the same
  content collection the pages come from (so it follows chapter edits with no
  extra step):
  - `/docs/llms.txt` — a table of contents: every chapter as
    `- [Title](absolute .md URL): description`, grouped under its section heading.
  - `/docs/<section>/<chapter>.md` — each chapter's **Markdown twin**: appending
    `.md` to any page URL returns that page's Markdown. The corpus is plain
    Markdown with no MDX or components, so a twin is the chapter body verbatim
    (any leading HTML comment stripped) plus its title, description and a footer
    linking back to the index and the HTML page.
  - `/docs/llms-full.txt` — every chapter concatenated, for agents that prefer one
    fetch over following the index.

  They are ordinary `src/pages/` routes, so they land in `dist/` unprefixed like
  every page and end up under `/docs/` once `dist/` is staged into the app's
  `public/docs/`.
- `scripts/verify-dist.mjs` — post-build guard run by the `build` script: fails
  loudly if any corpus chapter is missing its page in `dist/`, if the site chrome
  (index, 404, Pagefind) is absent, or if any chapter is missing its Markdown twin
  or its entry in `llms.txt` / `llms-full.txt` — an empty or partial site can never
  build green.

## Caveats

- **The site root `/` redirects to the first chapter** — the corpus has no index
  chapter and is read-only, so there is no landing page (`redirects` in
  `astro.config.mjs`; the static build emits a meta-refresh `index.html`).
- **Search (Pagefind) only works in `build`/`preview`**, not in `dev` — a Starlight
  limitation.
- Editing a chapter live-reloads the running dev server.
- The dev server is a daemon in Astro 7: stop it with `npx astro dev stop` (in this
  directory), not Ctrl-C alone.
- The build logs `Entry docs → 404 was not found.` — Starlight looking for an
  optional custom 404 chapter in the corpus. Harmless.
- **`site` is hardcoded to the public origin** (`https://novedu.at`, beside `base`
  in `astro.config.mjs`), because the llms.txt link index needs absolute URLs.
  Two knock-on effects: Starlight's built-in `@astrojs/sitemap` — registered on
  every build — emits `dist/sitemap-index.xml` + `sitemap-0.xml`, and every page
  gets a `<link rel="canonical">` / `og:url` pointing at that origin regardless of
  where the build is served from. Both are wanted for a public guide; there is no
  Starlight switch to turn the sitemap off.
- **The Markdown twins are the corpus source, not the rendered page.** They are
  byte-faithful to `src/content/docs/`, so they keep straight quotes where the
  HTML pages show Starlight's typographic ones (`don't` vs `don’t`) and keep
  Markdown constructs unexpanded. That is the point — an agent gets the source a
  teacher would edit.
- **`/docs/**.md` needs `Content-Disposition: inline`** (a `headers()` rule in the
  app's `next.config.ts`): Next serves `.md` as `text/markdown`, which browsers
  download rather than display. Without that rule the twins still work for agents
  but can't be read in a tab.
- The injected "Related chapters" heading is not part of the right-hand "On this
  page" ToC (that ToC is built from the markdown headings).

Author in **English only** for now; translation/localization, if ever, is a
downstream concern and not handled here.
