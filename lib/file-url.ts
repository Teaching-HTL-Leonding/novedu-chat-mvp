// The single definition of an app-hosted file's public GET URL. Pure (no
// next/headers, no DB) so BOTH client components (the files list) and server
// code (the pages and the save-time validator) build the exact same string —
// keeping the URL a teacher copies, the link the UI shows, and the URL the
// validator self-resolves from drifting apart.

/**
 * The public URL of an app-hosted YAML file. `origin` is the app origin
 * (`https://host`); pass `""` to get a root-relative URL (`/api/files/<name>`)
 * as a last-resort fallback when no origin could be resolved.
 */
export function filePublicUrl(origin: string, name: string): string {
  return `${origin}/api/files/${name}`;
}

/** The `/api/files/` prefix at a given origin — used to recognize self/sibling references. */
export function filesUrlPrefix(origin: string): string {
  return `${origin}/api/files/`;
}
