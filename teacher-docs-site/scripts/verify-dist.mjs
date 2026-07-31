// Post-build guard: Starlight's docsLoader silently yields an empty collection
// when the src/content/docs symlink is missing or broken, and an empty or
// partial site would otherwise build green and ship to production /docs. This
// script fails the `build` script loudly unless every corpus chapter made it
// into dist/.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = fileURLToPath(new URL("..", import.meta.url));
const contentDir = join(siteRoot, "src", "content", "docs");
const distDir = join(siteRoot, "dist");

function fail(message) {
  console.error(`[verify-dist] ${message}`);
  process.exit(1);
}

// 1. The corpus must be readable through the symlink.
let sections;
try {
  if (!statSync(contentDir).isDirectory()) throw new Error("not a directory");
  sections = readdirSync(contentDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
} catch {
  fail(
    "src/content/docs is not readable — is the symlink intact? It must point at ../teacher-docs/content (on Windows, enable Developer Mode or `git config core.symlinks true` and re-checkout)",
  );
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

// 3. Site chrome: root redirect, 404, and search index (drop the pagefind
// check if search is ever disabled).
for (const required of ["index.html", "404.html", "pagefind"]) {
  if (!existsSync(join(distDir, required))) {
    fail(`dist/${required} is missing`);
  }
}

console.log(`[verify-dist] ok — ${chapters.length} chapter pages, chrome intact`);
