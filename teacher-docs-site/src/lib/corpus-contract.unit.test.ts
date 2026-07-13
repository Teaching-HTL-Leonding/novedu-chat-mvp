/**
 * Contract test over the REAL teacher-docs corpus. It pins the invariants the
 * generated chapters must hold for the docs site to render them correctly —
 * so a regenerated chapter that violates the contract fails `npm test` / `qa`
 * instead of silently degrading on the site:
 *
 * - frontmatter carries the required fields; `related:` slugs resolve
 * - no body H1 (the page title renders from frontmatter)
 * - every `[[term]]` marker resolves against the glossary
 * - the glossary itself parses with unambiguous aliases and unique anchors
 */
// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { loadGlossary, normalizeTermKey } from "./glossary.ts";

const CONTENT_DIR = fileURLToPath(new URL("../../../teacher-docs/content", import.meta.url));

interface Chapter {
  /** Content-relative slug: "30-sharing-activities/01-creating-codes". */
  id: string;
  frontmatter: Record<string, unknown>;
  /** Body lines with fenced code blocks and inline code spans blanked out. */
  proseLines: string[];
}

function loadChapters(): Chapter[] {
  const chapters: Chapter[] = [];
  for (const section of readdirSync(CONTENT_DIR, { withFileTypes: true })) {
    if (!section.isDirectory()) continue;
    for (const file of readdirSync(join(CONTENT_DIR, section.name))) {
      if (!file.endsWith(".md")) continue;
      const raw = readFileSync(join(CONTENT_DIR, section.name, file), "utf8");
      const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) throw new Error(`${section.name}/${file}: no frontmatter block`);
      let inFence = false;
      const proseLines = (match[2] as string).split("\n").map((line) => {
        if (/^\s*```/.test(line)) {
          inFence = !inFence;
          return "";
        }
        // Blank inline code spans so a literal `[[term]]` in backticks is not a marker.
        return inFence ? "" : line.replace(/`[^`]*`/g, "");
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

  it("no chapter body carries an H1 (the title renders from frontmatter)", () => {
    for (const chapter of chapters) {
      const h1 = chapter.proseLines.find((line) => /^# /.test(line));
      expect(h1, `${chapter.id}: body H1 "${h1}" duplicates the frontmatter title`).toBeUndefined();
    }
  });

  it("every [[term]] marker resolves against the glossary", () => {
    const { lookup } = loadGlossary();
    for (const chapter of chapters) {
      const prose = chapter.proseLines.join("\n");
      for (const match of prose.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g)) {
        const term = normalizeTermKey(match[1] as string);
        expect(lookup.has(term), `${chapter.id}: unknown glossary term "[[${match[1]}]]"`).toBe(
          true,
        );
      }
    }
  });

  it("the glossary parses with unambiguous aliases and unique anchors", () => {
    // loadGlossary throws on malformed bullets, ambiguous aliases, and slug collisions.
    const { entries } = loadGlossary();
    expect(entries.length).toBeGreaterThanOrEqual(8);
  });
});
