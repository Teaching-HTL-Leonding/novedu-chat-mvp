// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

// The public build-identity probe: the three baked env vars (lib/version.ts) plus
// `cliVersion`, the CLI release this server was built with — the value
// `novedu-cli eval` compares against its own before grading (docs/cli-eval.md).

/** The version on disk, read independently of the route's build-time import. */
const packageCliVersion: string = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../cli/package.json", import.meta.url)), "utf8"),
).version;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/version", () => {
  it("answers the baked build identity plus the bundled CLI version", async () => {
    vi.stubEnv("APP_VERSION", "0.1.0.142");
    vi.stubEnv("APP_GIT_SHA", "abc123");
    vi.stubEnv("APP_BUILD_TIME", "2026-01-02T03:04:05.000Z");

    const body = await GET().json();

    expect(body).toEqual({
      version: "0.1.0.142",
      gitSha: "abc123",
      builtAt: "2026-01-02T03:04:05.000Z",
      cliVersion: packageCliVersion,
    });
  });

  it("falls back to the dev defaults when the image env vars are unset", async () => {
    vi.stubEnv("APP_VERSION", "");
    vi.stubEnv("APP_GIT_SHA", "");
    vi.stubEnv("APP_BUILD_TIME", "");

    const body = await GET().json();

    expect(body).toMatchObject({ version: "dev", gitSha: "unknown", builtAt: "unknown" });
  });

  it("reports cliVersion from cli/package.json — the contract the CLI checks", async () => {
    const body = (await GET().json()) as { cliVersion?: unknown };

    // A non-empty semver-ish string: `eval` treats anything else as unverifiable.
    expect(body.cliVersion).toBe(packageCliVersion);
    expect(body.cliVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});
