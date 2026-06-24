import { mintReadSas } from "@/lib/image-blob";
import type { ImageRef, ResolvedImage } from "@/lib/image-ref";
import { getActiveImage } from "@/lib/image-store";
import { resolveRelativeUrl } from "@/lib/relative-url";

// Turns an `ImageRef` embedded by a module into a usable `ResolvedImage` for
// `<ContentImage>`. Three shapes are handled:
//   - `hosted: true` — `src` is an app-hosted image NAME; the active row supplies
//     the blob path, which is minted into a short-lived read SAS URL.
//   - an absolute http(s) URL — used as-is.
//   - anything else — a relative path resolved against the module's base URL.
//
// Resolution is LENIENT: a missing ref, an unknown/soft-deleted hosted name, or
// a failed SAS mint yields `null` so the consumer simply omits the image rather
// than erroring.
//
// SERVER: mints a SAS and reads the image store. Never import from client
// components.

export async function resolveImageRef(
  ref: ImageRef | null | undefined,
  baseUrl: string,
): Promise<ResolvedImage | null> {
  if (!ref?.src) return null;

  if (ref.hosted === true) {
    const active = await getActiveImage(ref.src);
    if (!active) return null;
    // Stay lenient if the SAS mint fails (a transient credential / network
    // issue): omit the image rather than failing the whole consumer render.
    try {
      const url = await mintReadSas(active.blobPath);
      // A per-ref credit overrides the image's stored attribution.
      return { url, alt: ref.alt, credit: ref.credit ?? active.credit ?? undefined };
    } catch {
      return null;
    }
  }

  if (/^https?:\/\//i.test(ref.src)) {
    return { url: ref.src, alt: ref.alt, credit: ref.credit };
  }

  return { url: resolveRelativeUrl(ref.src, baseUrl), alt: ref.alt, credit: ref.credit };
}
