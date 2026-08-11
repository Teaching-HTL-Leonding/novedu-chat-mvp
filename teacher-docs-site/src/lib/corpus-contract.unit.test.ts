/**
 * Contract test over the REAL teacher-docs corpus. It pins the invariants the
 * generated chapters must hold for the docs site to render them correctly —
 * so a regenerated chapter that violates the contract fails `npm test` / `qa`
 * instead of silently degrading on the site:
 *
 * - frontmatter carries the required fields; `related:` slugs resolve
 * - no body H1 (the page title renders from frontmatter)
 * - every section directory is declared in src/lib/sections.ts
 */
// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { SECTIONS, sectionDir } from "./sections";

const CONTENT_DIR = fileURLToPath(new URL("../../../teacher-docs/content", import.meta.url));

interface Chapter {
  /** Content-relative slug: "30-sharing-activities/01-creating-codes". */
  id: string;
  frontmatter: Record<string, unknown>;
  /** Body lines with fenced code blocks blanked out. */
  proseLines: string[];
}

function loadChapters(): Chapter[] {
  const chapters: Chapter[] = [];
  for (const section of readdirSync(CONTENT_DIR, { withFileTypes: true })) {
    if (!section.isDirectory()) continue;
    for (const file of readdirSync(join(CONTENT_DIR, section.name))) {
      if (!file.endsWith(".md")) continue;
      const raw = readFileSync(join(CONTENT_DIR, section.name, file), "utf8");
      const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      if (!match) throw new Error(`${section.name}/${file}: no frontmatter block`);
      let inFence = false;
      const proseLines = (match[2] as string).split("\n").map((line) => {
        if (/^\s*```/.test(line)) {
          inFence = !inFence;
          return "";
        }
        return inFence ? "" : line;
      });
      chapters.push({
        id: `${section.name}/${file.replace(/\.md$/, "")}`,
        frontmatter: parseYaml(match[1] as string) as Record<string, unknown>,
        proseLines,
      });
    }
  }
  return chapters;
}

const chapters = loadChapters();
const ids = new Set(chapters.map((c) => c.id));

describe("teacher-docs corpus contract", () => {
  it("found the corpus", () => {
    expect(chapters.length).toBeGreaterThanOrEqual(22);
  });

  it("every chapter carries the required frontmatter", () => {
    for (const chapter of chapters) {
      const fm = chapter.frontmatter;
      for (const field of ["title", "description", "audience", "keywords", "generated"]) {
        expect(fm[field], `${chapter.id}: frontmatter "${field}"`).toBeDefined();
      }
    }
  });

  it("every related: slug resolves to a chapter", () => {
    for (const chapter of chapters) {
      const related = (chapter.frontmatter.related ?? []) as string[];
      for (const slug of related) {
        expect(ids.has(slug), `${chapter.id}: related slug "${slug}" matches no chapter`).toBe(
          true,
        );
      }
    }
  });

  it("every section directory is declared in sections.ts", () => {
    // sections.ts drives BOTH the sidebar and the llms.txt table of contents, so
    // an undeclared directory would be invisible in the guide's navigation. The
    // site build throws too; this fails faster and names the fix.
    const declared = new Set(SECTIONS.map((section) => section.dir));
    for (const dir of new Set(chapters.map((chapter) => sectionDir(chapter.id)))) {
      expect(declared.has(dir), `corpus section "${dir}" missing from sections.ts`).toBe(true);
    }
  });

  it("no chapter body carries an H1 (the title renders from frontmatter)", () => {
    for (const chapter of chapters) {
      const h1 = chapter.proseLines.find((line) => /^# /.test(line));
      expect(h1, `${chapter.id}: body H1 "${h1}" duplicates the frontmatter title`).toBeUndefined();
    }
  });
});
