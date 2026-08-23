/**
 * /docs/llms.txt — the table of contents an AI agent starts from: one entry per
 * chapter, grouped by section, each pointing at the chapter's Markdown twin
 * (see `[...slug].md.ts`). Absolute URLs, hence the `site` in astro.config.mjs.
 */
import type { APIRoute } from "astro";
import { buildIndex } from "../lib/llms";

export const GET: APIRoute = async ({ site }) => {
  const body = await buildIndex(site);
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
