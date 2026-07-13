import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { slugifyTerm } from "./slug.ts";

export interface GlossaryEntry {
  /** Canonical term, the bold text of the bullet: "Module / kind". */
  term: string;
  /** Display-only qualifier after the bold text: "(LLM sense)". Never part of key or slug. */
  qualifier?: string;
  /** Definition as raw inline markdown, hard-wrapped lines joined with a space. */
  definition: string;
  /** Anchor on the glossary page, from slugifyTerm(term). */
  slug: string;
}

/** Matches `- **Term**: definition` and `- **Term** (qualifier): definition`. */
const BULLET = /^-\s+\*\*(.+?)\*\*\s*(\([^)]*\))?\s*:\s*(.*)$/;

/**
 * Parses teacher-docs/glossary.md: prose preamble is skipped, each
 * `- **Term**: definition` bullet becomes an entry, indented continuation
 * lines extend the current definition. A line that starts like a bullet but
 * doesn't match the contract throws — a malformed entry must never silently
 * vanish from the glossary (its term markers would degrade to plain text).
 */
export function parseGlossary(markdown: string): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(BULLET);
    if (match) {
      const term = (match[1] as string).trim();
      entries.push({
        term,
        qualifier: match[2]?.trim(),
        definition: (match[3] as string).trim(),
        slug: slugifyTerm(term),
      });
      continue;
    }
    if (/^-\s/.test(line)) {
      throw new Error(
        `glossary bullet does not match \`- **Term**: definition\` (or \`- **Term** (qualifier): definition\`): "${line.trim()}" — fix teacher-docs/glossary.md`,
      );
    }
    const current = entries[entries.length - 1];
    const continuation = line.trim();
    // Indented, non-bullet lines are hard-wrapped continuations of the definition.
    if (current && continuation && /^\s/.test(line)) {
      current.definition = `${current.definition} ${continuation}`;
    }
  }
  return entries;
}

/**
 * Lookup keys per entry: the lowercased canonical term plus each lowercased
 * `/`-separated part — so `[[module|kind]]` resolves against "Module / kind".
 * "vs."-style terms are NOT split; chapter markers use them verbatim.
 * Throws on an ambiguous alias AND on two terms slugifying to the same anchor
 * (e.g. "Check-in" vs "Check in") — either would silently misdirect links.
 */
export function buildLookup(entries: GlossaryEntry[]): Map<string, GlossaryEntry> {
  const lookup = new Map<string, GlossaryEntry>();
  const bySlug = new Map<string, GlossaryEntry>();
  for (const entry of entries) {
    const slugOwner = bySlug.get(entry.slug);
    if (slugOwner) {
      throw new Error(
        `glossary terms "${slugOwner.term}" and "${entry.term}" produce the same anchor "#${entry.slug}" — rename one in teacher-docs/glossary.md`,
      );
    }
    bySlug.set(entry.slug, entry);

    const aliases = new Set([entry.term.toLowerCase()]);
    if (entry.term.includes("/")) {
      for (const part of entry.term.split("/")) {
        const alias = part.trim().toLowerCase();
        if (alias) aliases.add(alias);
      }
    }
    for (const alias of aliases) {
      const existing = lookup.get(alias);
      if (existing && existing !== entry) {
        throw new Error(
          `glossary alias "${alias}" is ambiguous between "${existing.term}" and "${entry.term}" — rename one in teacher-docs/glossary.md`,
        );
      }
      lookup.set(alias, entry);
    }
  }
  return lookup;
}

/**
 * Normalizes a chapter's `[[term]]` key for lookup: case-insensitive and
 * whitespace-collapsed, so a marker hard-wrapped across source lines still
 * resolves.
 */
export function normalizeTermKey(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface Glossary {
  entries: GlossaryEntry[];
  lookup: Map<string, GlossaryEntry>;
}

/**
 * This module runs in three contexts with different `import.meta.url` shapes:
 * as a real file under src/lib (the remark plugin imported by astro.config via
 * Node, the dev server, vitest) — where the relative hop resolves correctly —
 * and bundled into a prerender chunk under dist/.prerender/ when the built
 * glossary page renders, where only the cwd candidates work (astro runs with
 * cwd = teacher-docs-site via the npm workspace scripts). The repo-root cwd
 * candidate is checked BEFORE the parent-dir one so resolution can never
 * escape the repository.
 */
function resolveGlossaryPath(): string {
  const candidates: string[] = [];
  const fromModule = new URL("../../../teacher-docs/glossary.md", import.meta.url);
  if (fromModule.protocol === "file:") candidates.push(fileURLToPath(fromModule));
  candidates.push(
    resolve(process.cwd(), "teacher-docs/glossary.md"),
    resolve(process.cwd(), "../teacher-docs/glossary.md"),
  );
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `teacher-docs/glossary.md not found (tried: ${candidates.join(", ")}) — is the teacher-docs corpus checked out next to teacher-docs-site?`,
    );
  }
  return found;
}

/**
 * Reads and parses the corpus glossary. No caching: the file is 8 bullets and
 * this runs ~once per chapter transform, so a fresh read keeps dev rebuilds
 * exact and leaves no staleness edge cases.
 */
export function loadGlossary(): Glossary {
  const entries = parseGlossary(readFileSync(resolveGlossaryPath(), "utf8"));
  return { entries, lookup: buildLookup(entries) };
}
