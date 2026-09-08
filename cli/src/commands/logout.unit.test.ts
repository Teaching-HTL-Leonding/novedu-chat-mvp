// @vitest-environment node
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetSession, revokeSession, storedSession } from "../auth";
import { registerLogout } from "./logout";

// The session store and the sign-out request are mocked at the `../auth` seam so
// nothing touches ~/.novedu or the network (both are covered in auth.unit.test.ts).
vi.mock("../auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth")>();
  return {
    ...actual,
    storedSession: vi.fn(),
    revokeSession: vi.fn(),
    forgetSession: vi.fn(),
  };
});

const SERVER = "http://localhost:3000";

function runLogout(...args: string[]): Promise<Command> {
  const program = new Command();
  registerLogout(program);
  return program.parseAsync(["logout", ...args], { from: "user" });
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
  it("revokes the stored session server-side and forgets it locally", async () => {
    vi.mocked(storedSession).mockReturnValue({ token: "session-token", name: "Jane" });

    await runLogout("--server", SERVER);

    expect(revokeSession).toHaveBeenCalledWith(SERVER, "session-token");
    expect(forgetSession).toHaveBeenCalledWith(SERVER);
    expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({
      status: "signed-out",
      server: SERVER,
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("is idempotent when nothing is stored (no request, same output)", async () => {
    vi.mocked(storedSession).mockReturnValue(undefined);

    await runLogout("--server", SERVER);

    expect(revokeSession).not.toHaveBeenCalled();
    expect(forgetSession).toHaveBeenCalledWith(SERVER);
    expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({
      status: "signed-out",
      server: SERVER,
    });
  });

  it("signs out locally even when the server call fails", async () => {
    vi.mocked(storedSession).mockReturnValue({ token: "session-token", name: "Jane" });
    // The real revokeSession swallows its errors; this asserts the command does
    // not depend on the outcome either.
    vi.mocked(revokeSession).mockResolvedValue(undefined);

    await runLogout("--server", SERVER);

    expect(forgetSession).toHaveBeenCalledWith(SERVER);
    expect(process.exitCode).toBeUndefined();
  });
});
