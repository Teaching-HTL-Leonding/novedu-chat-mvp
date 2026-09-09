import { rm } from "node:fs/promises";
import { test as setup } from "@playwright/test";
import { E2E_IMAGE_ROOT } from "./image-root.constants";

// Provisions the harness's own image storage root BEFORE the dev server boots
// (playwright.config.ts passes `IMAGE_STORAGE_ROOT=E2E_IMAGE_ROOT` to the
// `npm run dev` webServer), mirroring auth.setup.ts's role for session state.
//
// Wipes ONLY `e2e/.image-root` — never any other path — then re-provisions it
// via the SAME helper `npm run images:init-root` uses, so a passing e2e run is
// proof the real provisioning path works too. The root package carries no
// `"type": "module"`, so Playwright transpiles specs to CJS; the helper is
// plain ESM, hence the dynamic `import()` instead of a static one.
setup("provision the image storage root", async () => {
  await rm(E2E_IMAGE_ROOT, { recursive: true, force: true });

  const { initImageRoot } = await import("../scripts/lib/image-root.mjs");
  await initImageRoot(E2E_IMAGE_ROOT);
});
