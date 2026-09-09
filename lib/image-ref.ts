// Reference + resolved types for content images.
//
// `ImageRef` is what a module embeds: a hosted image name (`hosted: true`), an
// absolute URL, or a relative path resolved against the module's base URL.
// `ResolvedImage` is the usable URL handed to `<ContentImage>` for rendering.
//
// PURE — no imports, no I/O. Safe to import from client components.

export interface ImageRef {
  hosted?: boolean;
  src: string;
  alt?: string;
  /** Optional attribution / "Content Credentials" (e.g. a CC BY notice), shown small below the image. */
  credit?: string;
}

export interface ResolvedImage {
  url: string;
  alt?: string;
  /** Attribution / "Content Credentials" to show small below the image, if any. */
  credit?: string;
}

/**
 * The shape of an image-version row id (`novedu_images.id`) — a UUID. Both the
 * store and the byte route check it before any lookup, so a malformed id costs
 * no query.
 */
export const IMAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The app's own URL for one image version's bytes. Root-relative: a browser
 * `<img>` sends the same-origin session cookie, which is exactly what
 * `GET /api/image-content/<id>` requires. The id is the IMMUTABLE version row
 * id, so a replaced image gets a new URL and the old one stays dead.
 */
export function imageContentPath(id: string): string {
  return `/api/image-content/${encodeURIComponent(id)}`;
}
