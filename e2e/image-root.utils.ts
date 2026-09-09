import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";

// Guards every image-storage e2e spec against the classic "wrong dev server"
// footgun: playwright.config.ts's `reuseExistingServer: !CI` means a dev
// server already listening on :3000 (started by hand, or left over from
// before this branch added IMAGE_STORAGE_ROOT) is reused AS-IS — with
// whatever root (or none) it originally booted with, silently different from
// `e2e/.image-root`. Call this once per spec (teacher-authenticated —
// `probe=images` is behind `requireEffectiveTeacher`) before touching image
// storage, so a mismatch fails with an actionable message instead of a
// confusing 404/503 deep in the test body. No runtime backdoor: this only
// READS the health probe.

/**
 * Asserts the dev server under test reports the given `IMAGE_STORAGE_ROOT` on
 * its `images` health probe. `request` must carry a teacher session (e.g. a
 * context built from `TEACHER_STORAGE_STATE`).
 */
export async function assertServerImageRoot(
  request: APIRequestContext,
  expectedRoot: string,
): Promise<void> {
  const res = await request.get("/api/health?probe=images");
  expect(res.ok(), `image health probe request failed (HTTP ${res.status()})`).toBeTruthy();
  const body = (await res.json()) as { ok: boolean; detail: string };

  const message =
    `The running dev server uses a different IMAGE_STORAGE_ROOT (${body.detail}). ` +
    `Stop it, or start it with IMAGE_STORAGE_ROOT=${expectedRoot} after ` +
    "`npm run images:init-root`.";
  expect(body.detail, message).toContain(expectedRoot);
}
