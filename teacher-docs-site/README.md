# Teacher docs site

Astro Starlight site that renders the teacher guide corpus in `../teacher-docs/`.
The corpus is authoritative and read-only for this site — the site adapts to the
corpus's conventions (see `teacher-docs/README.md` and `docs/teacher-docs.md`),
never the other way round.

**Local preview only for v1** — no hosting/deployment, no CI wiring.

## Commands (from the repo root)

```bash
npm run docs:dev       # dev server, http://localhost:4321
npm run docs:build     # static build to teacher-docs-site/dist/
npm run docs:preview   # serve the build output
```

The build doubles as the corpus's consistency check: frontmatter schema validation,
dead `related:` slugs (build failure), and unknown `[[term]]` markers (build
warning).

## How it hangs together

- `src/content.config.ts` — the `docs` collection reads `../teacher-docs/content`
  directly via a glob loader and extends Starlight's schema with the corpus's
  fields (`audience`, `keywords`, `related`, `generated`).
- `src/lib/` — shared slugifier, `glossary.md` parser, and the remark plugin that
  turns `[[term]]` / `[[term|shown]]` into links to `/glossary#<slug>`.
- `src/pages/glossary.astro` — the glossary page, generated from
  `teacher-docs/glossary.md`; one anchor per term, same slugifier as the plugin.
- `src/components/MarkdownContent.astro` — appends the "Related chapters" link
  cards from the frontmatter `related:` slugs; a dead slug fails the build.

## Caveats

- **The site root `/` redirects to the first chapter** — the corpus has no index
  chapter and is read-only, so there is no landing page (`redirects` in
  `astro.config.mjs`; the static build emits a meta-refresh `index.html`).

- **Search (Pagefind) only works in `build`/`preview`**, not in `dev` — a Starlight
  limitation.
- Editing a chapter live-reloads the running dev server (the loader watches the
  out-of-root corpus). Editing `glossary.md` takes effect on the next chapter
  rebuild or restart — the glossary itself does not trigger re-renders.
- The dev server is a daemon in Astro 7: stop it with `npx astro dev stop` (in this
  directory), not Ctrl-C alone.
- The build logs `Entry docs → 404 was not found.` (Starlight looking for an
  optional custom 404 chapter in the corpus) and a sitemap warning (no `site`
  configured — deliberate while the site is local-only). Both are harmless.
- The injected "Related chapters" heading is not part of the right-hand "On this
  page" ToC (that ToC is built from the markdown headings).
