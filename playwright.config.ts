import { defineConfig, devices } from "@playwright/test";
import { STORAGE_STATE } from "./e2e/auth.constants";
import { FAKE_LLM_BASE, FAKE_LLM_PORT } from "./e2e/fake-llm.constants";
import { FIXTURES_BASE, FIXTURES_PORT } from "./e2e/fixtures.constants";
import { E2E_IMAGE_ROOT } from "./e2e/image-root.constants";

// Two run modes share this file (docs/testing.md, "Fake LLM"):
//   - FAKE mode (this config, the default — `test:e2e`, CI's `test:e2e:ci`): the
//     app's SCCH provider points at the fake LLM, and `@live-llm` specs are not
//     selected.
//   - REAL mode (playwright.live-llm.config.ts, `test:e2e:live-llm`): the app
//     uses `.env`'s real providers, and ONLY `@live-llm` specs run.
// A run is all-fake or all-real, never mixed.

/** The app under test, booted with `env` on top of the process environment. */
export function appServer(options: { env?: Record<string, string>; reuse: boolean }) {
  return {
    // Both the server and the e2e helpers read the same `.env` (and the same
    // DATABASE_URL / AUTH_SECRET), so a minted session row and its cookie
    // signature always match what the server validates.
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: options.reuse,
    timeout: 120 * 1000,
    // Points the dev server's image storage at the harness root the `setup`
    // project just provisioned (e2e/image-root.setup.ts), never at whatever
    // `.env` sets locally. A REUSED server keeps whatever root IT booted with —
    // e2e/image-root.utils.ts's `assertServerImageRoot` catches that mismatch
    // with an actionable message.
    env: { ...process.env, IMAGE_STORAGE_ROOT: E2E_IMAGE_ROOT, ...options.env },
  };
}

// Serves the on-disk test fixtures over HTTP so specs fetch activity YAML
// offline. The dev server fetches these URLs server-side, so 127.0.0.1
// resolves. The port comes from e2e/fixtures.constants.ts — the same source
// the specs build their URLs from. Never reuse an existing listener: a stale
// fixtures server from another checkout/worktree would silently serve the
// WRONG fixture tree; startup costs milliseconds, and a hard port-in-use
// error beats cross-contamination.
export const fixturesServer = {
  command: "node test-fixtures/serve.mjs",
  env: { E2E_FIXTURES_PORT: String(FIXTURES_PORT) },
  url: `${FIXTURES_BASE}/`,
  reuseExistingServer: false,
  timeout: 30 * 1000,
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  // The suite runs against `next dev`, which compiles each route on its first
  // hit — slow under parallel load. A spec sets its own limit only above these.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  // Real-LLM specs need real-mode's config. A command-line --grep-invert stacks
  // with this (a test must pass both), so test:e2e:ci's own filter still applies.
  grepInvert: /@live-llm/,
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
    // The fake LLM comes FIRST: web servers start in array order, and the app
    // lists the SCCH models once at boot (app/mastra/scch.ts), so the fake must
    // already answer by then. Never reused, for the fixtures server's reason.
    {
      command: "node fake-llm/server.mjs",
      env: { FAKE_LLM_PORT: String(FAKE_LLM_PORT) },
      url: `${FAKE_LLM_BASE}/models`,
      reuseExistingServer: false,
      timeout: 30 * 1000,
    },
    // Never reused in fake mode: a dev server already on :3000 normally talks
    // to a real model, so a fake-mode run fails with port-in-use instead of
    // silently hitting it. Only SCCH is redirected; Foundry and OpenRouter keep
    // whatever `.env` sets.
    appServer({
      env: { SCCH_BASE_URL: FAKE_LLM_BASE, SCCH_API_KEY: "fake-llm" },
      reuse: false,
    }),
    fixturesServer,
  ],
});
