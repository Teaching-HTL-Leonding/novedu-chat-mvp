// @vitest-environment node
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DeviceCode,
  fetchIdentity,
  getAccessToken,
  NotSignedInError,
  openBrowser,
  pollDeviceToken,
  rememberSession,
  requestDeviceCode,
} from "../auth";
import { registerLogin } from "./login";

// The whole device flow is mocked at the `../auth` seam: this suite is about the
// command's contract — silent short-circuit, JSON on stdout, human hints on
// stderr — not about the HTTP wire (covered in auth.unit.test.ts).
vi.mock("../auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth")>();
  return {
    ...actual,
    getAccessToken: vi.fn(),
    fetchIdentity: vi.fn(),
    requestDeviceCode: vi.fn(),
    pollDeviceToken: vi.fn(),
    rememberSession: vi.fn(),
    openBrowser: vi.fn(),
  };
});

const SERVER = "http://localhost:3000";

const CODE: DeviceCode = {
  device_code: "dev-code-1",
  user_code: "ABCD2345",
  verification_uri: "http://localhost:3000/device",
  verification_uri_complete: "http://localhost:3000/device?user_code=ABCD2345",
  expires_in: 1800,
  interval: 5,
};

const IDENTITY = { name: "Jane Teacher", userId: "u1", isTeacher: true };

function runLogin(...args: string[]): Promise<Command> {
  const program = new Command();
  registerLogin(program);
  return program.parseAsync(["login", ...args], { from: "user" });
}

let log: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

const stdout = () => log.mock.calls.map((c: unknown[]) => c[0] as string);
const stderr = () => error.mock.calls.map((c: unknown[]) => c[0] as string);

beforeEach(() => {
  vi.clearAllMocks();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  log.mockRestore();
  error.mockRestore();
  process.exitCode = undefined;
});

describe("login", () => {
  it("short-circuits when the stored session still works (agent-safe)", async () => {
    vi.mocked(getAccessToken).mockResolvedValue("stored-token");
    vi.mocked(fetchIdentity).mockResolvedValue(IDENTITY);

    await runLogin("--server", SERVER);

    expect(getAccessToken).toHaveBeenCalledWith(SERVER);
    expect(JSON.parse(stdout()[0])).toEqual({
      status: "already-signed-in",
      name: "Jane Teacher",
      server: SERVER,
    });
    expect(requestDeviceCode).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("runs the device flow, printing the link and code on stderr", async () => {
    vi.mocked(getAccessToken).mockRejectedValue(new NotSignedInError());
    vi.mocked(requestDeviceCode).mockResolvedValue(CODE);
    vi.mocked(pollDeviceToken).mockResolvedValue("session-token");
    vi.mocked(fetchIdentity).mockResolvedValue(IDENTITY);

    await runLogin("--server", SERVER);

    // Stdout stays JSON-only; the human instructions go to stderr.
    expect(stderr()).toEqual([
      "Open http://localhost:3000/device?user_code=ABCD2345",
      "Code: ABCD2345",
    ]);
    expect(openBrowser).toHaveBeenCalledWith(CODE.verification_uri_complete);
    expect(pollDeviceToken).toHaveBeenCalledWith(SERVER, CODE);
    // Stored first (name still unknown), then refreshed with the probed name.
    expect(rememberSession).toHaveBeenNthCalledWith(1, SERVER, {
      token: "session-token",
      name: "",
    });
    expect(rememberSession).toHaveBeenNthCalledWith(2, SERVER, {
      token: "session-token",
      name: "Jane Teacher",
    });
    expect(JSON.parse(stdout()[0])).toEqual({
      status: "signed-in",
      name: "Jane Teacher",
      server: SERVER,
    });
  });

  it("re-runs the flow when the stored token is no longer accepted", async () => {
    vi.mocked(getAccessToken).mockResolvedValue("stale-token");
    vi.mocked(fetchIdentity).mockResolvedValueOnce(null).mockResolvedValueOnce(IDENTITY);
    vi.mocked(requestDeviceCode).mockResolvedValue(CODE);
    vi.mocked(pollDeviceToken).mockResolvedValue("session-token");

    await runLogin("--server", SERVER);

    expect(requestDeviceCode).toHaveBeenCalledWith(SERVER);
    expect(JSON.parse(stdout()[0]).status).toBe("signed-in");
  });

  it("exits 1 without starting a device flow when the server is unreachable", async () => {
    // An outage is not a dead session: burning a human approval here would be
    // the wrong answer, and the stored session is very likely still fine.
    vi.mocked(getAccessToken).mockResolvedValue("stored-token");
    vi.mocked(fetchIdentity).mockRejectedValue(new Error("Could not reach localhost: ECONN"));

    await runLogin("--server", SERVER);

    expect(JSON.parse(stderr().at(-1) as string).message).toMatch(/Could not reach/);
    expect(requestDeviceCode).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("keeps the redeemed token when the follow-up name probe fails", async () => {
    // The session already exists server-side; discarding the token over a probe
    // hiccup would orphan a 30-day row and force another human approval.
    vi.mocked(getAccessToken).mockRejectedValue(new NotSignedInError());
    vi.mocked(requestDeviceCode).mockResolvedValue(CODE);
    vi.mocked(pollDeviceToken).mockResolvedValue("session-token");
    vi.mocked(fetchIdentity).mockRejectedValue(new Error("localhost answered HTTP 502."));

    await runLogin("--server", SERVER);

    expect(rememberSession).toHaveBeenCalledWith(SERVER, { token: "session-token", name: "" });
    expect(JSON.parse(stdout()[0])).toEqual({
      status: "signed-in",
      name: null,
      server: SERVER,
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("exits 1 with the reason when the code is denied", async () => {
    vi.mocked(getAccessToken).mockRejectedValue(new NotSignedInError());
    vi.mocked(requestDeviceCode).mockResolvedValue(CODE);
    vi.mocked(pollDeviceToken).mockRejectedValue(new Error("Sign-in was denied in the browser."));

    await runLogin("--server", SERVER);

    expect(JSON.parse(stderr().at(-1) as string)).toEqual({
      message: "Sign-in was denied in the browser.",
    });
    expect(rememberSession).not.toHaveBeenCalled();
    expect(stdout()).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it("exits 1 when the server refuses to start the flow", async () => {
    vi.mocked(getAccessToken).mockRejectedValue(new NotSignedInError());
    vi.mocked(requestDeviceCode).mockRejectedValue(
      new Error("Could not start the sign-in: unknown client"),
    );

    await runLogin("--server", SERVER);

    expect(JSON.parse(stderr()[0]).message).toMatch(/unknown client/);
    expect(pollDeviceToken).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("falls back to the NOVEDU_SERVER env var for the base URL", async () => {
    vi.stubEnv("NOVEDU_SERVER", "http://localhost:9999");
    vi.mocked(getAccessToken).mockResolvedValue("stored-token");
    vi.mocked(fetchIdentity).mockResolvedValue(IDENTITY);
    try {
      await runLogin();
      expect(JSON.parse(stdout()[0]).server).toBe("http://localhost:9999");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
