/**
 * Resolve a reference to an absolute URL. An absolute http(s) ref is used as-is;
 * anything else is treated as relative to `baseUrl` — standard URL resolution drops
 * the base's filename and appends the relative path (so `./` / `../` segments work too).
 * Throws if a relative ref is unparseable.
 */
export function resolveRelativeUrl(ref: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(ref)) return ref;
  return new URL(ref, baseUrl).href;
}
