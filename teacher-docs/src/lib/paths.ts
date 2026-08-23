/**
 * Prefixes a site-root-relative path (no leading slash) with the deploy base.
 * `base` is Astro's `import.meta.env.BASE_URL` shape: "/" for the local v1
 * site, "/docs" (no trailing slash) under the deferred sub-path deployment.
 * Every internal link the site emits goes through this, so changing the base
 * in astro.config.mjs is the single seam.
 */
export function withBase(base: string, path: string): string {
  return `${base.endsWith("/") ? base : `${base}/`}${path}`;
}
