// Post-build guard: Starlight's docsLoader silently yields an empty collection
// when src/content/docs is missing or unreadable, and an empty or partial site
// would otherwise build green and ship to production /docs. This script fails
// the `build` script loudly unless every corpus chapter made it into dist/.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const siteRoot = fileURLToPath(new URL("..", import.meta.url));
const contentDir = join(siteRoot, "src", "content", "docs");
const distDir = join(siteRoot, "dist");

function fail(message) {
  console.error(`[verify-dist] ${message}`);
  process.exit(1);
}

// The llms.txt surface (src/pages/llms*.ts). Every chapter's Markdown twin is
// checked separately below, against the corpus.
const LLMS_FILES = ["llms.txt", "llms-full.txt"];

/**
 * A chapter's frontmatter `title` — as llms-full.txt writes it. Parsed out of
 * the frontmatter block ONLY (several chapters embed example activity YAML
 * carrying its own `title:` key inside fenced code blocks), with the same YAML
 * parser the builder sees through Astro, so quoting/escaping can never make the
 * two disagree.
 */
function chapterTitle(slug) {
  const frontmatter = readFileSync(join(contentDir, `${slug}.md`), "utf8").match(
    /^---\r?\n([\s\S]*?)\r?\n---/,
  );
  let title;
  try {
    title = parseYaml(frontmatter?.[1] ?? "")?.title;
  } catch {
    fail(`${slug}.md: frontmatter is not parseable YAML`);
  }
  if (typeof title !== "string" || title === "") {
    fail(`${slug}.md: no frontmatter title — the corpus contract requires one`);
  }
  return title;
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 1. The corpus directory must be readable.
let sections;
try {
  if (!statSync(contentDir).isDirectory()) throw new Error("not a directory");
  sections = readdirSync(contentDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
} catch {
  fail("src/content/docs is not readable — the corpus directory is missing or unreadable");
}

// 2. Every corpus chapter <section>/<chapter>.md must have its page in dist/.
// Assumes filename === URL slug, which holds because corpus filenames are
// lowercase-hyphen and chapters use no `slug:`/`draft:` frontmatter, no
// index.md, no .mdx. A violation fails this check loudly, never silently.
const chapters = sections.flatMap((section) =>
  readdirSync(join(contentDir, section))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `${section}/${name.replace(/\.md$/, "")}`),
);
if (chapters.length === 0) {
  fail("no chapter .md files found under src/content/docs — the corpus is empty");
}
const missing = chapters.filter((slug) => !existsSync(join(distDir, slug, "index.html")));
if (missing.length > 0) {
  fail(`chapter pages missing from dist/:\n  ${missing.join("\n  ")}`);
}

// 3. Site chrome: root redirect, 404, search index (drop the pagefind check if
// search is ever disabled), and the sitemap that `site` in astro.config.mjs
// activates — docs/teacher-docs.md advertises it as part of the /docs surface.
for (const required of [
  "index.html",
  "404.html",
  "pagefind",
  "sitemap-index.xml",
  "sitemap-0.xml",
  ...LLMS_FILES,
]) {
  if (!existsSync(join(distDir, required))) {
    fail(`dist/${required} is missing`);
  }
}

// 4. Every chapter needs its Markdown twin (<section>/<chapter>.md), and must
// appear in BOTH llms.txt and llms-full.txt. Those three come from their own
// getCollection() call in src/lib/llms.ts, so a filter or schema regression there
// could drop chapters while the HTML pages above still build fine.
const llmsIndex = readFileSync(join(distDir, "llms.txt"), "utf8");
const llmsFull = readFileSync(join(distDir, "llms-full.txt"), "utf8");
for (const [label, missingChapters] of [
  [
    "Markdown twins (dist/<chapter>.md)",
    chapters.filter((s) => !existsSync(join(distDir, `${s}.md`))),
  ],
  // The index links each twin by absolute URL, so the chapter path arrives
  // slash-prefixed and closes the Markdown link: "/<section>/<chapter>.md)".
  ["dist/llms.txt", chapters.filter((s) => !llmsIndex.includes(`/${s}.md)`))],
  // Whole-line match: an unanchored substring would also hit "## <title>",
  // "# <title>" inside a fenced example, or a longer title.
  [
    "dist/llms-full.txt",
    chapters.filter((s) => !new RegExp(`^# ${escapeRegExp(chapterTitle(s))}$`, "m").test(llmsFull)),
  ],
]) {
  if (missingChapters.length > 0) {
    fail(`chapters missing from ${label}:\n  ${missingChapters.join("\n  ")}`);
  }
}

// Titles are not unique across the corpus, so a per-title match alone could
// false-pass when one of two same-titled chapters is dropped. Chapter bodies
// carry no H1 (corpus contract) — every top-level `# ` line outside a fenced
// code block is a chapter heading, so the count must match exactly.
let inFence = false;
const headingCount = llmsFull.split("\n").filter((line) => {
  if (/^\s*```/.test(line)) {
    inFence = !inFence;
    return false;
  }
  return !inFence && line.startsWith("# ");
}).length;
if (headingCount !== chapters.length) {
  fail(
    `dist/llms-full.txt carries ${headingCount} chapter headings, expected ${chapters.length} — a chapter was dropped or a body grew a top-level heading`,
  );
}

console.log(
  `[verify-dist] ok — ${chapters.length} chapter pages + Markdown twins, chrome intact, llms.txt index complete`,
);
