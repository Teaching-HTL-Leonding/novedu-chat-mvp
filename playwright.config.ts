import { defineConfig, devices } from "@playwright/test";
import { STORAGE_STATE } from "./e2e/auth.constants";
import { FIXTURES_BASE, FIXTURES_PORT } from "./e2e/fixtures.constants";
import { E2E_IMAGE_ROOT } from "./e2e/image-root.constants";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    // Creates the two e2e principals in `novedu_user`/`novedu_session` and mints
    // their signed better-auth session cookies into STORAGE_STATE (the app is
    // gated by Entra ID); the chromium project consumes the student one so specs
    // run authenticated instead of being bounced to /sign-in. Also provisions
    // the harness's own image storage root (e2e/image-root.setup.ts) before the
    // dev server below boots against it.
    { name: "setup", testMatch: /(auth|image-root)\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    // The app under test. Both the server and the e2e helpers read the same
    // `.env` (and the same DATABASE_URL / AUTH_SECRET), so a minted session row
    // and its cookie signature always match what the server validates.
    {
      command: "npm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      // Points the dev server's image storage at the harness root the `setup`
      // project just provisioned (e2e/image-root.setup.ts), never at whatever
      // `.env` sets locally. A REUSED server (reuseExistingServer above) keeps
      // whatever root IT booted with — e2e/image-root.utils.ts's
      // `assertServerImageRoot` catches that mismatch with an actionable message.
      env: { ...process.env, IMAGE_STORAGE_ROOT: E2E_IMAGE_ROOT },
    },
    // Serves the on-disk test fixtures over HTTP so specs fetch activity YAML
    // offline. The dev server fetches these URLs server-side, so 127.0.0.1
    // resolves. The port comes from e2e/fixtures.constants.ts — the same source
    // the specs build their URLs from. Never reuse an existing listener: a stale
    // fixtures server from another checkout/worktree would silently serve the
    // WRONG fixture tree; startup costs milliseconds, and a hard port-in-use
    // error beats cross-contamination.
    {
      command: "node test-fixtures/serve.mjs",
      env: { E2E_FIXTURES_PORT: String(FIXTURES_PORT) },
      url: `${FIXTURES_BASE}/`,
      reuseExistingServer: false,
      timeout: 30 * 1000,
    },
  ],
});
