import { defineCollection } from "astro:content";
import { docsSchema } from "@astrojs/starlight/schema";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

export const collections = {
  docs: defineCollection({
    // Reads the corpus directly — no copy step. A wrong base silently yields an
    // EMPTY collection; src/pages/glossary.astro guards against that at build time.
    loader: glob({ pattern: "**/*.md", base: "../teacher-docs/content" }),
    schema: docsSchema({
      extend: z.object({
        audience: z.string(),
        keywords: z.array(z.string()),
        // Optional per the corpus frontmatter contract ("omit if there are none").
        related: z.array(z.string()).default([]),
        generated: z.boolean(),
      }),
    }),
  }),
};
