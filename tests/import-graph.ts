import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

// The mechanics behind the repo's import grep-guards (`lib/prompt-dump.unit.test.ts`,
// `lib/telemetry-isolation.unit.test.ts`): read a module's import specifiers, resolve the
// repo-relative ones, and walk a transitive closure from a set of roots. WHAT counts as an
// offender and WHICH imports keep the walk going is the caller's business — every guard
// expresses that through its `visit` callback, so this file holds no policy. Never used by
// the app; a test helper only.

/** Repo root, resolved from this file's own location (`tests/`). */
export const REPO_ROOT = join(__dirname, "..");

/** Reads a repo-relative source file. */
export const readModule = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf8");

/** Every static/dynamic/side-effect/re-export specifier in a module's source. */
export const importSpecifiers = (source: string): string[] =>
  [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g), // import/export … from "x"
    ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm), // import "x" (side effect)
    ...source.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']/g), // import("x")
  ].map((m) => m[1] ?? "");

export type ResolvedImport = {
  /** The specifier exactly as written — the only form a bare package name survives in. */
  specifier: string;
  /** Repo-relative path, or null for a bare package / `node:` specifier. */
  rel: string | null;
  /** Whether `rel` names a file that exists in the repo. */
  exists: boolean;
};

/**
 * Resolve one specifier against the importing module. Bare package / `node:` specifiers
 * resolve to `rel: null`; a repo path that resolves to nothing is still returned
 * (`exists: false`) so a guard's forbidden-path check sees it either way.
 */
export const resolveImport = (fromFile: string, specifier: string): ResolvedImport => {
  let base: string;
  if (specifier.startsWith("@/")) base = specifier.slice(2);
  else if (specifier.startsWith(".")) base = join(dirname(fromFile), specifier);
  else return { specifier, rel: null, exists: false };
  base = normalize(base).replace(/\\/g, "/");
  for (const rel of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (isRepoFile(rel)) return { specifier, rel, exists: true };
  }
  return { specifier, rel: base, exists: false };
};

const isRepoFile = (rel: string): boolean => {
  const abs = join(REPO_ROOT, rel);
  return existsSync(abs) && statSync(abs).isFile();
};

export type VisitedModule = {
  /** Repo-relative path of the module being visited. */
  rel: string;
  /** Its source text. */
  source: string;
  /** Its resolved imports, in source order. */
  imports: ResolvedImport[];
};

/**
 * Walk the transitive import closure of `roots`. Each module is visited exactly once;
 * `visit` inspects it (asserting, collecting offenders — whatever the guard needs) and
 * returns the repo-relative paths to enqueue. Queued paths that are not existing repo
 * files are skipped.
 *
 * Returns the set of visited paths, so a guard can prove its walk was not vacuous.
 */
export const walkClosure = (
  roots: Iterable<string>,
  visit: (module: VisitedModule) => Iterable<string>,
): Set<string> => {
  const visited = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const rel = queue.pop() as string;
    if (visited.has(rel) || !isRepoFile(rel)) continue;
    visited.add(rel);
    const source = readModule(rel);
    const imports = importSpecifiers(source).map((specifier) => resolveImport(rel, specifier));
    for (const next of visit({ rel, source, imports })) queue.push(next);
  }
  return visited;
};
