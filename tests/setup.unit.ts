import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// lib/thread-token.ts stays real in tests and derives its HMAC key from
// AUTH_SECRET, so every unit test gets one (reset with all env stubs after it).
beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "unit-test-secret");
});

afterEach(() => {
  cleanup();
});
