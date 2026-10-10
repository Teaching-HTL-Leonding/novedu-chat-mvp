import { defineConfig } from "@playwright/test";
import fakeModeConfig, { appServer, fixturesServer } from "./playwright.config";

// REAL mode (`npm run test:e2e:live-llm`): only the `@live-llm` specs, against
// the real providers `.env` configures — no fake LLM, no SCCH override. A dev
// server already running on :3000 may be reused locally (it normally talks to a
// real model). A second config file rather than an env-var switch keeps the npm
// script cross-platform. docs/testing.md, "Fake LLM".
export default defineConfig({
  ...fakeModeConfig,
  grepInvert: undefined,
  // The filter sits on the test project, not the config: a config-level `grep`
  // would also drop the `setup` project's (untagged) tests.
  projects: fakeModeConfig.projects?.map((project) =>
    project.name === "chromium" ? { ...project, grep: /@live-llm/ } : project,
  ),
  webServer: [appServer({ reuse: !process.env.CI }), fixturesServer],
});
