import { type ImageRef, imageContentPath, type ResolvedImage } from "@/lib/image-ref";
import { getActiveImage } from "@/lib/image-store";
import { resolveRelativeUrl } from "@/lib/relative-url";

// Turns an `ImageRef` embedded by a module into a usable `ResolvedImage` for
// `<ContentImage>`. Three shapes are handled:
//   - `hosted: true` — `src` is an app-hosted image NAME; the active row supplies
//     the version id, which becomes the app's own byte URL
//     `/api/image-content/<id>` (root-relative, so the browser sends the session
//     cookie the route requires).
//   - an absolute http(s) URL — used as-is.
//   - anything else — a relative path resolved against the module's base URL.
//
// Resolution is LENIENT: a missing ref or an unknown/soft-deleted hosted name
// yields `null` so the consumer simply omits the image rather than erroring. No
// storage call happens here at all — only the metadata lookup.
//
// SERVER: reads the image store. Never import from client components.

export async function resolveImageRef(
  ref: ImageRef | null | undefined,
  baseUrl: string,
): Promise<ResolvedImage | null> {
  if (!ref?.src) return null;

  if (ref.hosted === true) {
    const active = await getActiveImage(ref.src);
    if (!active) return null;
    // A per-ref credit overrides the image's stored attribution.
    return {
      url: imageContentPath(active.id),
      alt: ref.alt,
      credit: ref.credit ?? active.credit ?? undefined,
    };
  }

  if (/^https?:\/\//i.test(ref.src)) {
    return { url: ref.src, alt: ref.alt, credit: ref.credit };
  }

  return { url: resolveRelativeUrl(ref.src, baseUrl), alt: ref.alt, credit: ref.credit };
}
