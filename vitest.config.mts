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
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
