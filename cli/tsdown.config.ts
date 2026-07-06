import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

// Bundles the CLI into plain Node ESM so `npx @novedu/cli` needs no tsconfig /
// tsx at runtime. The tutor-validation core (`@/lib/tutors`) is inlined by
// reference — single source of truth, zero duplicated logic — while its runtime
// libraries stay external so npm can dedupe them. The shebang is added
// automatically for the `bin` entry declared in package.json.
export default defineConfig({
  entry: { main: "src/main.ts" },
  format: ["esm"],
  platform: "node",
  // Emit `dist/main.js` (not `.mjs`) — the package is `type: module`, so this is
  // ESM, and it matches the `bin` path so tsdown injects the shebang for it.
  fixedExtension: false,
  // Resolve `@/…` to the repo root, exactly like the app's tsconfig path alias,
  // so CLI source imports `@/lib/tutors` and tsdown inlines those files.
  alias: {
    "@": fileURLToPath(new URL("..", import.meta.url)),
  },
  deps: {
    neverBundle: ["commander", "yaml", "zod", "handlebars", "@azure/msal-node"],
  },
  dts: false,
  clean: true,
});
