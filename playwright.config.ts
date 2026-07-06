import { defineConfig, devices } from "@playwright/test";
import { STORAGE_STATE } from "./e2e/auth.constants";
import { FIXTURES_BASE, FIXTURES_PORT } from "./e2e/fixtures.constants";

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
    // Mints a valid Auth.js session cookie (the app is gated by Entra ID) and
    // writes it to STORAGE_STATE; the chromium project consumes it so specs run
    // authenticated instead of being bounced to the Microsoft sign-in page.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      command: "npm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
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
