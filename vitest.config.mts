import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const sharedExclude = ["e2e/**", "node_modules/**", ".next/**"];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          setupFiles: ["./tests/setup.unit.ts"],
          include: ["tests/unit/**/*.{test,spec}.{ts,tsx}", "**/*.unit.test.{ts,tsx}"],
          exclude: sharedExclude,
          // Two projects may only differ in `maxWorkers` when they also sit in
          // different sequence groups, so the browser project's cap (below)
          // forces an explicit order here. Cheap unit run first, then the
          // browser one — which also puts the fast feedback first.
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "component",
          include: ["tests/component/**/*.{test,spec}.{ts,tsx}", "**/*.browser.test.{ts,tsx}"],
          exclude: sharedExclude,
          // Cap the concurrent browser tabs. Browser mode's own default is
          // `min(12, cpus - 1)` tabs, and on a many-core dev box those 12 tabs
          // saturate the Vite server hard enough that some of them miss the
          // tester client's connect deadline (60s, hard-coded in
          // @vitest/browser). Vitest never fails a tab that was lost that way —
          // it waits for it forever, so the whole run HANGS instead of erroring.
          // Four tabs stays clear of that and still beats serial 2:1 (~17s vs
          // ~35s). Derived rather than fixed so small CI runners keep the
          // default they already pass with: this only ever lowers the cap.
          // NOTE: browser mode reads maxWorkers off the PROJECT config — the
          // `--maxWorkers` CLI flag does not reach it.
          maxWorkers: Math.min(4, Math.max(1, availableParallelism() - 1)),
          sequence: { groupOrder: 1 },
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            // A desktop viewport so responsive component tests (e.g. the writing
            // surface's side-by-side split + divider) exercise the wide layout;
            // the default tester iframe is too narrow and would render stacked.
            instances: [{ browser: "chromium", viewport: { width: 1280, height: 800 } }],
          },
        },
      },
    ],
  },
});
