import { headers } from "next/headers";

// The app's own public origin (`https://host`), used to build absolute URLs that
// point back at this deployment — the link for a code, and the public GET URL of
// an app-hosted YAML file.
//
// Prefer the explicit CODE_ORIGIN env var (set it in production — forwarded
// headers are only as trustworthy as the proxy chain in front of the app);
// TUTOR_CODE_ORIGIN is still read as a fallback so an existing prod app-setting
// keeps working. Without either, fall back to the request's forwarded/host
// headers, which is fine for local dev. Multi-hop proxies append comma-separated
// values, so only the first (client-most) entry counts. Throws if no host can be
// determined.
export async function resolveAppOrigin(): Promise<string> {
  const configured = process.env.CODE_ORIGIN ?? process.env.TUTOR_CODE_ORIGIN;
  if (configured) return new URL(configured).origin;

  const h = await headers();
  const first = (value: string | null) => value?.split(",")[0]?.trim() || undefined;
  const host = first(h.get("x-forwarded-host")) ?? first(h.get("host"));
  if (!host) throw new Error("No host header");
  const proto = first(h.get("x-forwarded-proto")) ?? "http";
  return new URL(`${proto}://${host}`).origin;
}

/**
 * Like {@link resolveAppOrigin} but never throws — returns `fallback` when no
 * origin can be determined. For best-effort absolute-URL building (page links,
 * copyable URLs) so callers stop re-implementing the same try/catch; pass `""`
 * to fall back to root-relative URLs.
 */
export async function resolveAppOriginOr(fallback: string): Promise<string> {
  try {
    return await resolveAppOrigin();
  } catch {
    return fallback;
  }
}
