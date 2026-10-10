import { describe, expect, it, vi } from "vitest";
import { isLimitExempt, limitsEnabled } from "./enabled";

describe("limitsEnabled (fail-closed)", () => {
  it("is on when LIMITS_ENABLED is unset", () => {
    vi.stubEnv("LIMITS_ENABLED", undefined);
    expect(limitsEnabled()).toBe(true);
  });

  it.each(["false", "FALSE", " false\n"])("is off for %j", (value) => {
    vi.stubEnv("LIMITS_ENABLED", value);
    expect(limitsEnabled()).toBe(false);
  });

  it.each(["true", "", "0", "no", "off", "flase"])("stays on for %j", (value) => {
    vi.stubEnv("LIMITS_ENABLED", value);
    expect(limitsEnabled()).toBe(true);
  });
});

describe("isLimitExempt", () => {
  it("limits a student while limits are on", () => {
    vi.stubEnv("LIMITS_ENABLED", "true");
    expect(isLimitExempt({ teacher: false })).toBe(false);
  });

  it("exempts an effective teacher", () => {
    vi.stubEnv("LIMITS_ENABLED", "true");
    expect(isLimitExempt({ teacher: true })).toBe(true);
  });

  it("exempts everyone when limits are switched off", () => {
    vi.stubEnv("LIMITS_ENABLED", "false");
    expect(isLimitExempt({ teacher: false })).toBe(true);
  });
});
