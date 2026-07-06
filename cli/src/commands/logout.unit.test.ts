// @vitest-environment node
import { existsSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPca, TOKEN_CACHE_PATH } from "../auth";
import { registerLogout } from "./logout";

// TOKEN_CACHE_PATH is redirected into a temp dir so the test can create and
// observe a real cache file without touching ~/.novedu. Importing it above
// yields the mocked (temp) path.
vi.mock("../auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth")>();
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return {
    ...actual,
    TOKEN_CACHE_PATH: join(mkdtempSync(join(tmpdir(), "novedu-logout-test-")), "token-cache.json"),
    buildPca: vi.fn(),
  };
});

function runLogout(): Promise<Command> {
  const program = new Command();
  registerLogout(program);
  return program.parseAsync(["logout"], { from: "user" });
}

let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  log.mockRestore();
  process.exitCode = undefined;
});

describe("logout", () => {
  it("removes every cached account and deletes the cache file", async () => {
    writeFileSync(TOKEN_CACHE_PATH, "{}");
    const accounts = [{ homeAccountId: "a" }, { homeAccountId: "b" }];
    const removeAccount = vi.fn().mockResolvedValue(undefined);
    vi.mocked(buildPca).mockReturnValue({
      getTokenCache: () => ({ getAllAccounts: async () => accounts, removeAccount }),
    } as never);

    await runLogout();

    expect(removeAccount).toHaveBeenCalledTimes(2);
    expect(existsSync(TOKEN_CACHE_PATH)).toBe(false);
    expect(log).toHaveBeenCalledWith("Signed out.");
  });

  it("is idempotent when already signed out (no accounts, no file)", async () => {
    vi.mocked(buildPca).mockReturnValue({
      getTokenCache: () => ({ getAllAccounts: async () => [], removeAccount: vi.fn() }),
    } as never);

    await runLogout();

    expect(log).toHaveBeenCalledWith("Signed out.");
    expect(process.exitCode).toBeUndefined();
  });
});
