// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightThemeRapide from "starlight-theme-rapide";
import { GUIDE_TITLE } from "./src/lib/guide.ts";
import { SECTIONS } from "./src/lib/sections.ts";

// Canonical origin of the published guide (an Azure Static Web App, see
// docs/teacher-docs.md) — stamped into the llms.txt table of contents (which
// needs absolute URLs), the sitemap and the pages' canonical tags, so it must be
// the real public origin rather than wherever a given build runs. The site is
// served at the root of this origin; local dev runs at http://localhost:4321/.
// See "Changing the public domain" in the root README for the other places
// that name it.
const site = "https://docs.novedu.at";

export default defineConfig({
  site,
  // The corpus has no index chapter (and is read-only for the site), so the site
  // root goes straight to the guide's first chapter.
  redirects: {
    "/": "/00-introduction/01-what-is-novedu/",
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
