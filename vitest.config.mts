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
        },
      },
      {
        extends: true,
        test: {
          name: "component",
          include: ["tests/component/**/*.{test,spec}.{ts,tsx}", "**/*.browser.test.{ts,tsx}"],
          exclude: sharedExclude,
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
