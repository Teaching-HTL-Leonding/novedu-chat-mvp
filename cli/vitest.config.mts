import { defineConfig } from "vitest/config";

// Standalone config for the CLI's integration tests. These spawn the *built* CLI
// binary and some hit the network (public tutor YAMLs on GitHub), so they are
// deliberately NOT matched by the root `unit`/`component` globs and never run in
// CI. Run them locally as a pre-push smoke via `npm run test:cli` (the script
// builds the CLI first). This mirrors the repo's `@live` boundary.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: "cli-integration",
    environment: "node",
    include: ["test/**/*.integration.test.ts"],
    testTimeout: 30_000,
  },
});
