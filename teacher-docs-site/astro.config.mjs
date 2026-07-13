// @ts-check
import { unified } from "@astrojs/markdown-remark";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightThemeRapide from "starlight-theme-rapide";
import { withBase } from "./src/lib/paths.ts";
import { remarkGlossaryTerms } from "./src/lib/remark-glossary-terms.ts";

// The deploy base — the site ships at /docs inside the Novedu web app (copied
// into its public/ dir at image build). The glossary-term links, the
// related-chapter cards (via import.meta.env.BASE_URL), and the root redirect
// below all derive from this single seam. Local dev serves at
// http://localhost:4321/docs/ accordingly.
const base = "/docs";

export default defineConfig({
  base,
  // The corpus has no index chapter (and is read-only for the site), so the site
  // root goes straight to the guide's first chapter. Astro base-prefixes only the
  // redirect SOURCE, never the destination — hence withBase.
  redirects: {
    "/": withBase(base, "00-introduction/01-what-is-novedu/"),
  },
  markdown: {
    // Astro 7: top-level markdown.remarkPlugins is deprecated; Starlight detects the
    // unified() processor and appends its own plugins, so asides/anchors keep working.
    processor: unified({ remarkPlugins: [[remarkGlossaryTerms, { base }]] }),
  },
  integrations: [
    starlight({
      title: "Novedu teacher guide",
      plugins: [starlightThemeRapide()],
      components: {
        MarkdownContent: "./src/components/MarkdownContent.astro",
      },
      // Section names mirror teacher-docs/CHAPTERS.md — that manifest is the IA authority.
      sidebar: [
        { label: "Introduction", items: [{ autogenerate: { directory: "00-introduction" } }] },
        {
          label: "YAML for teachers",
          items: [{ autogenerate: { directory: "10-yaml-for-teachers" } }],
        },
        {
          label: "Building activities",
          items: [{ autogenerate: { directory: "20-building-activities" } }],
        },
        {
          label: "Sharing activities",
          items: [{ autogenerate: { directory: "30-sharing-activities" } }],
        },
        { label: "Glossary", link: withBase(base, "glossary") },
      ],
    }),
  ],
});
