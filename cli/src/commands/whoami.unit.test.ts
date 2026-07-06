// @vitest-environment node
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccessToken, NotSignedInError } from "../auth";
import { registerWhoami } from "./whoami";

vi.mock("../auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth")>();
  return { ...actual, getAccessToken: vi.fn() };
});

const fetchMock = vi.fn();

function runWhoami(...args: string[]): Promise<Command> {
  const program = new Command();
  registerWhoami(program);
  return program.parseAsync(["whoami", ...args], { from: "user" });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let log: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getAccessToken).mockResolvedValue("token-123");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  log.mockRestore();
  error.mockRestore();
  process.exitCode = undefined;
});

describe("whoami", () => {
  it("calls /api/me with the bearer token and prints the identity", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ name: "Jane Teacher", userId: "oid-1", isTeacher: true }),
    );

    await runWhoami("--server", "http://localhost:1234");

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe("http://localhost:1234/api/me");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token-123");
    expect(log.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      "Signed in as Jane Teacher",
      "User id: oid-1",
      "Teacher: yes",
    ]);
    expect(process.exitCode).toBeUndefined();
  });

  it("falls back to the NOVEDU_SERVER env var for the base URL", async () => {
    vi.stubEnv("NOVEDU_SERVER", "http://localhost:9999");
    fetchMock.mockResolvedValue(jsonResponse({ name: null, userId: "oid-2", isTeacher: false }));

    await runWhoami();

    expect((fetchMock.mock.calls[0] as [URL])[0].href).toBe("http://localhost:9999/api/me");
    expect(log.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      "Signed in as (no name)",
      "User id: oid-2",
      "Teacher: no",
    ]);
  });

  it("exits 1 with a hint when not signed in", async () => {
    vi.mocked(getAccessToken).mockRejectedValue(new NotSignedInError());

    await runWhoami();

    expect(error).toHaveBeenCalledWith('Not signed in — run "novedu-cli login".');
    expect(process.exitCode).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exits 1 and reports the HTTP status when the server rejects the token", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Unauthorized" }, 401));

    await runWhoami("--server", "http://localhost:1234");

    expect(error).toHaveBeenCalledWith("http://localhost:1234 rejected the request: HTTP 401");
    expect(process.exitCode).toBe(1);
  });

  it("exits 1 and names the server on a network failure", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await runWhoami("--server", "http://localhost:1234");

    expect(error).toHaveBeenCalledWith("Could not reach http://localhost:1234: ECONNREFUSED");
    expect(process.exitCode).toBe(1);
  });
});
