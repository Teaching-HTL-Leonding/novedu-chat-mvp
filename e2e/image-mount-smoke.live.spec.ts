import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import { mintSessionToken } from "./api-auth.utils";
import { TEACHER_STORAGE_STATE } from "./auth.constants";

// @live @live-storage: a MANUAL, opt-in smoke test against the REAL Azure
// Files mount an operator has pointed a running app at — the only image test
// that needs actual mounted storage rather than the harness's local
// e2e/.image-root. Everything else in this repo's image coverage
// (e2e/image-management.live.spec.ts, tagged @live-db) runs against a local
// filesystem root and needs no real mount at all.
//
// Skips CLEANLY (test.skip, no failure) unless IMAGE_SMOKE_ROOT is set — never
// run in CI, and not part of the default local `--grep @live` sweep either
// (excluded by npm run test:e2e:ci's `@live-storage` filter the same way
// @live-llm is). Run it by hand, against a dev server whose IMAGE_STORAGE_ROOT
// is the same mounted path, with:
//
//   IMAGE_SMOKE_ROOT=/novedu-files npm run test:e2e:storage
//
// It creates and removes exactly ONE object under its own name — never
// unmounts the share, never truncates or corrupts the mount, and never
// touches any other object already there.

loadEnvConfig(process.cwd());

const IMAGE_SMOKE_ROOT = process.env.IMAGE_SMOKE_ROOT || "/novedu-files";
const RED_PNG = path.join(process.cwd(), "e2e", "fixtures", "red.png");

test.describe("image storage mount smoke test", () => {
  test.use({ storageState: TEACHER_STORAGE_STATE });
  test.setTimeout(60_000);

  test("the mounted root is healthy and a real upload/read/delete round-trips", {
    tag: ["@live", "@live-storage"],
  }, async ({ page, request }) => {
    test.skip(!process.env.IMAGE_SMOKE_ROOT, "IMAGE_SMOKE_ROOT is not set — manual/opt-in only.");

    // The dev server under test must itself be booted with
    // IMAGE_STORAGE_ROOT=IMAGE_SMOKE_ROOT — this probe proves that, with the
    // same actionable-mismatch shape the harness root check uses.
    const probe = await request.get("/api/health?probe=images");
    const body = (await probe.json()) as { ok: boolean; detail: string };
    expect(
      body.detail,
      `The running dev server's IMAGE_STORAGE_ROOT does not match IMAGE_SMOKE_ROOT ` +
        `(${IMAGE_SMOKE_ROOT}); probe detail: ${body.detail}. Start the dev server with ` +
        `IMAGE_STORAGE_ROOT=${IMAGE_SMOKE_ROOT}.`,
    ).toContain(IMAGE_SMOKE_ROOT);
    expect(body.ok).toBe(true);

    const name = `smoke-${Date.now()}`;
    const bytes = await readFile(RED_PNG);
    const token = await mintSessionToken({ teacher: true });

    const upload = await request.post(`/api/images/${name}`, {
      headers: { authorization: `Bearer ${token}` },
      multipart: {
        file: { name: "red.png", mimeType: "image/png", buffer: bytes },
        mime: "image/png",
      },
    });
    expect(upload.status()).toBe(201);
    const uploaded = (await upload.json()) as { id: string };

    // The cookie-session route needs the browser session, not the bearer
    // token — read it through the authenticated `page`'s own request
    // context (the `TEACHER_STORAGE_STATE` cookie from `test.use` above).
    const viaSession = await page.request.get(`/api/image-content/${uploaded.id}`);
    expect(viaSession.status()).toBe(200);
    expect((await viaSession.body()).length).toBe(bytes.length);

    // Delete via the UI — the only delete affordance — then confirm the
    // object is gone. No database fallback here on purpose: this spec is
    // tagged @live-storage ONLY (not @live-db), so it never touches
    // novedu_images directly — a failed UI step is a genuine spec failure,
    // not something to paper over.
    await page.goto("/images");
    await page.getByLabel("Filter images").fill(name);
    await page.getByRole("button", { name: "Apply" }).click();
    await page.getByRole("checkbox", { name: `Select ${name}` }).check();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: /Delete .*selected/i }).click();
    await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);

    const afterDelete = await page.request.get(`/api/image-content/${uploaded.id}`);
    expect(afterDelete.status()).toBe(404);
  });
});
