// @vitest-environment node
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchIdentity, getAccessToken, NotSignedInError } from "../auth";
import { registerWhoami } from "./whoami";

// Mocked at the `../auth` seam: this suite is about the command's JSON contract,
// not the HTTP wire (fetchIdentity's own behaviour is covered in
// auth.unit.test.ts).
vi.mock("../auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth")>();
  return { ...actual, getAccessToken: vi.fn(), fetchIdentity: vi.fn() };
});

function runWhoami(...args: string[]): Promise<Command> {
  const program = new Command();
  registerWhoami(program);
  return program.parseAsync(["whoami", ...args], { from: "user" });
}

let log: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

const stdout = () => log.mock.calls.map((c: unknown[]) => c[0] as string);
const stderr = () => error.mock.calls.map((c: unknown[]) => c[0] as string);

beforeEach(() => {
  vi.clearAllMocks();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getAccessToken).mockResolvedValue("token-123");
});

afterEach(() => {
  vi.unstubAllEnvs();
  log.mockRestore();
  error.mockRestore();
  process.exitCode = undefined;
});

describe("whoami", () => {
  it("prints the identity as JSON on stdout", async () => {
    vi.mocked(fetchIdentity).mockResolvedValue({
      name: "Jane Teacher",
      userId: "u1",
      isTeacher: true,
    });

    await runWhoami("--server", "http://localhost:1234");

    expect(fetchIdentity).toHaveBeenCalledWith("http://localhost:1234", "token-123");
    expect(JSON.parse(stdout()[0] as string)).toEqual({
      name: "Jane Teacher",
      userId: "u1",
      isTeacher: true,
      server: "http://localhost:1234",
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("falls back to the NOVEDU_SERVER env var for the base URL", async () => {
    vi.stubEnv("NOVEDU_SERVER", "http://localhost:9999");
    vi.mocked(fetchIdentity).mockResolvedValue({ name: null, userId: "u2", isTeacher: false });

    await runWhoami();

    expect(JSON.parse(stdout()[0] as string)).toEqual({
      name: null,
      userId: "u2",
      isTeacher: false,
      server: "http://localhost:9999",
    });
  });

  it("exits 1 with JSON on stderr when nothing is stored", async () => {
    vi.mocked(getAccessToken).mockRejectedValue(new NotSignedInError());

    await runWhoami();

    expect(JSON.parse(stderr()[0] as string)).toEqual({
      message: 'Not signed in — run "novedu-cli login".',
    });
    expect(process.exitCode).toBe(1);
    expect(stdout()).toEqual([]);
  });

  it("exits 1 when the server rejects the stored token", async () => {
    vi.mocked(fetchIdentity).mockResolvedValue(null);

    await runWhoami("--server", "http://localhost:1234");

    expect(JSON.parse(stderr()[0] as string).message).toMatch(/rejected the stored token/);
    expect(process.exitCode).toBe(1);
  });

  it("exits 1 and names the server when it cannot be reached", async () => {
    vi.mocked(fetchIdentity).mockRejectedValue(
      new Error("Could not reach http://localhost:1234: ECONNREFUSED"),
    );

    await runWhoami("--server", "http://localhost:1234");

    expect(JSON.parse(stderr()[0] as string).message).toMatch(/localhost:1234/);
    expect(process.exitCode).toBe(1);
  });
});
