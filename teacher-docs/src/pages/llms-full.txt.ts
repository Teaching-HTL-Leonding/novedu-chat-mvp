/**
 * /docs/llms-full.txt — the whole guide as one Markdown document, for agents
 * that would rather ingest everything than follow the llms.txt index.
 */
import type { APIRoute } from "astro";
import { buildFullText } from "../lib/llms";

export const GET: APIRoute = async () => {
  const body = await buildFullText();
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
