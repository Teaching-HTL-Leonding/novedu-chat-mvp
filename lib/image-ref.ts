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
