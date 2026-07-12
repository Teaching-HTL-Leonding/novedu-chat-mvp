import { existsSync, readFileSync, statSync } from "node:fs";
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
 * lines extend the current definition.
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
    const current = entries[entries.length - 1];
    const continuation = line.trim();
    // Indented, non-bullet lines are hard-wrapped continuations of the definition.
    if (current && continuation && /^\s/.test(line) && !continuation.startsWith("- ")) {
      current.definition = `${current.definition} ${continuation}`;
    }
  }
  return entries;
}

/**
 * Lookup keys per entry: the lowercased canonical term plus each lowercased
 * `/`-separated part — so `[[module|kind]]` resolves against "Module / kind".
 * "vs."-style terms are NOT split; chapter markers use them verbatim.
 */
export function buildLookup(entries: GlossaryEntry[]): Map<string, GlossaryEntry> {
  const lookup = new Map<string, GlossaryEntry>();
  for (const entry of entries) {
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
 * The corpus glossary, relative to this repo. Candidates cover the contexts this
 * module runs in: as a real Vite/vitest module (import.meta.url = this file) and
 * inlined into the esbuild-bundled astro.config (import.meta.url = bundle in the
 * site root), plus cwd fallbacks for either the site or the repo root.
 */
function resolveGlossaryPath(): string {
  const candidates = [
    fileURLToPath(new URL("../../../teacher-docs/glossary.md", import.meta.url)),
    fileURLToPath(new URL("../teacher-docs/glossary.md", import.meta.url)),
    resolve(process.cwd(), "../teacher-docs/glossary.md"),
    resolve(process.cwd(), "teacher-docs/glossary.md"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `teacher-docs/glossary.md not found (tried: ${candidates.join(", ")}) — is the teacher-docs corpus checked out next to teacher-docs-site?`,
  );
}

export interface Glossary {
  entries: GlossaryEntry[];
  lookup: Map<string, GlossaryEntry>;
}

let cache: { path: string; mtimeMs: number; glossary: Glossary } | undefined;

/**
 * Reads and parses the glossary with an mtime cache, so a dev-server rebuild
 * after editing glossary.md picks up the change without a restart.
 */
export function loadGlossary(): Glossary {
  const path = cache?.path ?? resolveGlossaryPath();
  const mtimeMs = statSync(path).mtimeMs;
  if (!cache || cache.mtimeMs !== mtimeMs) {
    const entries = parseGlossary(readFileSync(path, "utf8"));
    cache = { path, mtimeMs, glossary: { entries, lookup: buildLookup(entries) } };
  }
  return cache.glossary;
}
