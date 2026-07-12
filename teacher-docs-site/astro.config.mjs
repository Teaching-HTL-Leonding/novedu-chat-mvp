// @ts-check
import { unified } from "@astrojs/markdown-remark";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightThemeRapide from "starlight-theme-rapide";
import { remarkGlossaryTerms } from "./src/lib/remark-glossary-terms.ts";

export default defineConfig({
  markdown: {
    // Astro 7: top-level markdown.remarkPlugins is deprecated; Starlight detects the
    // unified() processor and appends its own plugins, so asides/anchors keep working.
    processor: unified({ remarkPlugins: [remarkGlossaryTerms] }),
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
        { label: "Glossary", link: "/glossary" },
      ],
    }),
  ],
});
