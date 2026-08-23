/**
 * /docs/<section>/<chapter>.md — the Markdown twin of every chapter: appending
 * `.md` to a page URL returns that page's source Markdown. This is what the
 * llms.txt table of contents links to.
 *
 * The pattern ends in `.md`, so it does not collide with Starlight's own
 * `[...slug]` catch-all that renders the HTML pages.
 */
import type { APIRoute, GetStaticPaths } from "astro";
import { type Chapter, chapterTwin, loadChapters } from "../lib/llms";

export const getStaticPaths: GetStaticPaths = async () => {
  const chapters = await loadChapters();
  return chapters.map((chapter) => ({ params: { slug: chapter.id }, props: { chapter } }));
};

export const GET: APIRoute = ({ props, site }) => {
  const body = chapterTwin(props.chapter as Chapter, site);
  return new Response(body, { headers: { "content-type": "text/markdown; charset=utf-8" } });
};
