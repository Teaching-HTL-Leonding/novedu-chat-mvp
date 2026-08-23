// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightThemeRapide from "starlight-theme-rapide";
import { GUIDE_TITLE } from "./src/lib/guide.ts";
import { withBase } from "./src/lib/paths.ts";
import { SECTIONS } from "./src/lib/sections.ts";

// The deploy base — the site ships at /docs inside the Novedu web app (copied
// into its public/ dir at image build). The related-chapter cards (via
// import.meta.env.BASE_URL) and the redirects below all derive from this
// single seam. Local dev serves at http://localhost:4321/docs/ accordingly.
const base = "/docs";

// Canonical origin of the published guide — stamped into the llms.txt table of
// contents (which needs absolute URLs), the sitemap and the pages' canonical
// tags, so it must be the real public origin rather than wherever a given build
// runs. The CLI keeps its own (overridable) default in cli/src/server-url.ts;
// both change together on a domain move — see "Changing the public domain" in
// the root README.
const site = "https://novedu.at";

export default defineConfig({
  base,
  site,
  // The corpus has no index chapter (and is read-only for the site), so the site
  // root goes straight to the guide's first chapter. Astro base-prefixes only the
  // redirect SOURCE, never the destination — hence withBase.
  redirects: {
    "/": withBase(base, "00-introduction/01-what-is-novedu/"),
    // The glossary was removed; keep bookmarked /docs/glossary from 404ing.
    "/glossary": withBase(base, "00-introduction/01-what-is-novedu/"),
  },
  integrations: [
    starlight({
      title: GUIDE_TITLE,
      plugins: [starlightThemeRapide()],
      components: {
        MarkdownContent: "./src/components/MarkdownContent.astro",
      },
      // Sections come from src/lib/sections.ts, which mirrors
      // teacher-docs/CHAPTERS.md (the IA authority) and also drives the llms.txt
      // table of contents — so sidebar and TOC can never drift apart.
      sidebar: SECTIONS.map(({ dir, label }) => ({
        label,
        items: [{ autogenerate: { directory: dir } }],
      })),
    }),
  ],
});
