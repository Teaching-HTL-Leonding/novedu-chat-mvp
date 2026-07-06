// @vitest-environment node
import type { AuthenticationResult } from "@azure/msal-node";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireByDeviceCode, acquireInteractive, acquireSilent } from "../auth";
import { registerLogin } from "./login";

vi.mock("../auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth")>();
  return {
    ...actual,
    buildPca: vi.fn(() => ({})),
    acquireSilent: vi.fn(),
    acquireByDeviceCode: vi.fn(),
    acquireInteractive: vi.fn(),
  };
});

const RESULT = { account: { name: "Jane Teacher" } } as unknown as AuthenticationResult;

function runLogin(...args: string[]): Promise<Command> {
  const program = new Command();
  registerLogin(program);
  return program.parseAsync(["login", ...args], { from: "user" });
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

describe("login", () => {
  it("short-circuits when a cached account still works (agent-safe)", async () => {
    vi.mocked(acquireSilent).mockResolvedValue(RESULT);

    await runLogin();

    expect(log).toHaveBeenCalledWith("Already signed in as Jane Teacher.");
    expect(acquireInteractive).not.toHaveBeenCalled();
    expect(acquireByDeviceCode).not.toHaveBeenCalled();
  });

  it("defaults to the interactive browser flow and prints the fallback URL", async () => {
    vi.mocked(acquireSilent).mockResolvedValue(null);
    vi.mocked(acquireInteractive).mockImplementation(async (_pca, onUrl) => {
      onUrl("https://login.example/authorize");
      return RESULT;
    });

    await runLogin();

    expect(acquireByDeviceCode).not.toHaveBeenCalled();
    expect(log.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      "A browser window should open for the Microsoft sign-in.",
      "If it does not, open this URL yourself:\nhttps://login.example/authorize",
      "Signed in as Jane Teacher.",
    ]);
  });

  it("runs the device code flow with --device-code, printing the instructions first", async () => {
    vi.mocked(acquireSilent).mockResolvedValue(null);
    vi.mocked(acquireByDeviceCode).mockImplementation(async (_pca, onMessage) => {
      onMessage("go to https://microsoft.com/devicelogin, code ABC");
      return RESULT;
    });

    await runLogin("--device-code");

    expect(acquireInteractive).not.toHaveBeenCalled();
    expect(log.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      "go to https://microsoft.com/devicelogin, code ABC",
      "Signed in as Jane Teacher.",
    ]);
  });
});
