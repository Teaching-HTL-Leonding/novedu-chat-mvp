import { describe, expect, it, vi } from "vitest";
import { parseAuthMode } from "@/lib/auth-mode";

// The build-time sign-in switch (docs/auth.md, "Demo mode"): `next.config.ts` parses
// NOVEDU_AUTH_MODE once and ALWAYS re-emits it through `config.env`, so every branch
// site folds at build time — an unset variable must still be emitted, or a live
// runtime lookup would stay in the bundle.

describe("parseAuthMode", () => {
  it.each([
    [{}, "entra"],
    [{ NOVEDU_AUTH_MODE: "" }, "entra"],
    [{ NOVEDU_AUTH_MODE: "entra" }, "entra"],
    [{ NOVEDU_AUTH_MODE: "demo" }, "demo"],
  ])("%j → %s", (env, mode) => {
    expect(parseAuthMode(env)).toBe(mode);
  });

  it.each(["Demo", "DEMO", "microsoft", "true", " demo"])("rejects %j", (value) => {
    expect(() => parseAuthMode({ NOVEDU_AUTH_MODE: value })).toThrow(/one of entra, demo/);
  });

  it.each(["demo", "entra", ""])("refuses a set NEXT_PUBLIC_NOVEDU_AUTH_MODE (%j)", (value) => {
    expect(() =>
      parseAuthMode({ NOVEDU_AUTH_MODE: "entra", NEXT_PUBLIC_NOVEDU_AUTH_MODE: value }),
    ).toThrow(/NEXT_PUBLIC_NOVEDU_AUTH_MODE must not be set/);
  });
});

describe("next.config.ts", () => {
  async function loadConfig() {
    vi.resetModules();
    return (await import("@/next.config")).default;
  }

  it("always emits the mode through config.env, also when unset", async () => {
    vi.stubEnv("NOVEDU_AUTH_MODE", undefined);
    expect((await loadConfig()).env).toEqual({ NOVEDU_AUTH_MODE: "entra" });
  });

  it("emits demo when the build asks for it", async () => {
    vi.stubEnv("NOVEDU_AUTH_MODE", "demo");
    expect((await loadConfig()).env).toEqual({ NOVEDU_AUTH_MODE: "demo" });
  });

  it("fails the build on an unknown mode", async () => {
    vi.stubEnv("NOVEDU_AUTH_MODE", "open");
    await expect(loadConfig()).rejects.toThrow(/NOVEDU_AUTH_MODE must be one of/);
  });
});
