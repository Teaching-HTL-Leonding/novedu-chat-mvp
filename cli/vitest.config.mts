import { defineConfig } from "vitest/config";

// Standalone config for the CLI's integration tests. These spawn the *built* CLI
// binary (`dist/main.js` must exist), so they are deliberately NOT matched by the
// root `unit`/`component` globs — `npm run test:cli` builds the CLI first, then
// runs this config; `qa.yml` runs that script in CI. They are fully offline
// (served-URL cases run a local fixtures server). Run them locally too, as a
// pre-push smoke, via `npm run test:cli`.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: "cli-integration",
    environment: "node",
    include: ["test/**/*.integration.test.ts"],
    testTimeout: 30_000,
  },
});
