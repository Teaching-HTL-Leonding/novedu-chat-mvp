// Provisioning helper for the app-hosted image storage root — the one place
// that CREATES `<root>`, `<root>/images` and the `<root>/.novedu-files-root`
// sentinel. `lib/image-fs.ts` (the runtime adapter) deliberately never creates
// any of this; only an operator (or this script, or the e2e harness) does.
//
// Plain ESM under `scripts/`, loaded both by `scripts/init-image-root.mjs`
// (operator CLI) and by `e2e/image-root.setup.ts` (the Playwright harness),
// and imported BY PATH from `lib/image-fs.unit.test.ts` for a sentinel-parity
// check — so `SENTINEL_FILE`/`SENTINEL_CONTENT` here must always match the
// adapter's exactly. No top-level await (importable from a Vitest module).

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** Must match `lib/image-fs.ts`'s `SENTINEL_FILE` byte-for-byte. */
export const SENTINEL_FILE = ".novedu-files-root";
/** Must match `lib/image-fs.ts`'s `SENTINEL_CONTENT` byte-for-byte. */
export const SENTINEL_CONTENT = "novedu-files-v1\n";

// Roots that would silently provision (and thereby "bless") a directory no
// operator meant as image storage — refused outright, never just warned about.
const REFUSED_ROOTS = new Set(["/", "/home"]);

/**
 * Creates (idempotently) `<root>`, `<root>/images` and the sentinel file.
 * Refuses a relative path or one of the deliberately dangerous roots above.
 * Safe to call repeatedly: re-running against an already-provisioned root
 * changes nothing (the sentinel content is rewritten with the same bytes).
 */
export async function initImageRoot(root) {
  if (typeof root !== "string" || root.trim() === "") {
    throw new Error("initImageRoot: root must be a non-empty string.");
  }
  if (!path.isAbsolute(root)) {
    throw new Error(`initImageRoot: root must be an absolute path (got "${root}").`);
  }
  const normalized = path.resolve(root);
  if (REFUSED_ROOTS.has(normalized)) {
    throw new Error(`initImageRoot: refusing to provision "${normalized}" as an image root.`);
  }

  await mkdir(normalized, { recursive: true });
  await mkdir(path.join(normalized, "images"), { recursive: true });
  await writeFile(path.join(normalized, SENTINEL_FILE), SENTINEL_CONTENT);

  return normalized;
}
