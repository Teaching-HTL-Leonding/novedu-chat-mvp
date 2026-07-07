// @vitest-environment node
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccessToken, NotSignedInError } from "../auth";
import { registerCodes } from "./codes";

// The codes command group: flag → request mapping and the JSON output contract
// (success pretty-printed on stdout, every failure — auth, network, server
// rejection — as JSON on stderr with exit 1). Auth and fetch are mocked like in
// the whoami tests.

vi.mock("../auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth")>();
  return { ...actual, getAccessToken: vi.fn() };
});

const fetchMock = vi.fn();

function run(...args: string[]): Promise<Command> {
  const program = new Command();
  registerCodes(program);
  return program.parseAsync(["codes", ...args], { from: "user" });
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

describe("codes create", () => {
  it("POSTs the flags as the API body and pretty-prints the created code to stdout", async () => {
    const created = { code: "abc123def4", url: "https://app/abc123def4" };
    fetchMock.mockResolvedValue(jsonResponse(created, 201));

    await run(
      "create",
      "--module",
      "quiz",
      "--file",
      "https://example.com/quiz.yaml",
      "--start",
      "2026-07-07T08:00:00Z",
      "--note",
      "3A",
      "--server",
      "http://localhost:1234",
    );

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe("http://localhost:1234/api/codes");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token-123");
    expect(JSON.parse(init.body as string)).toEqual({
      module: "quiz",
      fileUrl: "https://example.com/quiz.yaml",
      validFrom: "2026-07-07T08:00:00Z",
      note: "3A",
    });
    expect(log).toHaveBeenCalledWith(JSON.stringify(created, null, 2));
    expect(process.exitCode).toBeUndefined();
  });

  it("sends the llm pair only when a half is given", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 201));
    await run(
      "create",
      "--module",
      "tutor",
      "--file",
      "https://x/t.yaml",
      "--llm-provider",
      "SCCH",
      "--llm-model",
      "m1",
      "--server",
      "http://localhost:1234",
    );
    expect(JSON.parse((fetchMock.mock.calls[0] as [URL, RequestInit])[1].body as string)).toEqual({
      module: "tutor",
      fileUrl: "https://x/t.yaml",
      llm: { provider: "SCCH", model: "m1" },
    });
  });

  it("prints the server's structured validation errors verbatim on stderr, exit 1", async () => {
    const body = { errors: [{ code: "TUTOR_SCHEMA_ERROR", message: "bad" }] };
    fetchMock.mockResolvedValue(jsonResponse(body, 400));

    await run("create", "--module", "tutor", "--file", "https://x/t.yaml", "--server", "http://x");

    expect(error).toHaveBeenCalledWith(JSON.stringify(body, null, 2));
    expect(process.exitCode).toBe(1);
    expect(log).not.toHaveBeenCalled();
  });

  it("reports not-signed-in as JSON on stderr, exit 1, without fetching", async () => {
    vi.mocked(getAccessToken).mockRejectedValue(new NotSignedInError());

    await run("create", "--module", "tutor", "--file", "https://x/t.yaml");

    expect(error).toHaveBeenCalledWith(
      JSON.stringify({ message: 'Not signed in — run "novedu-cli login".' }, null, 2),
    );
    expect(process.exitCode).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("codes list", () => {
  it("GETs with no params by default (only my codes) and prints the array", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ code: "abc123def4" }]));

    await run("list", "--server", "http://localhost:1234");

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe("http://localhost:1234/api/codes");
    expect(init.method).toBe("GET");
    expect(log).toHaveBeenCalledWith(JSON.stringify([{ code: "abc123def4" }], null, 2));
  });

  it("maps --search/--module/--all onto q/module/mine=0", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await run("list", "--search", "bio", "--module", "quiz", "--all", "--server", "http://x");

    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.searchParams.get("q")).toBe("bio");
    expect(url.searchParams.get("module")).toBe("quiz");
    expect(url.searchParams.get("mine")).toBe("0");
  });

  it("reports a network failure as JSON on stderr, exit 1", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await run("list", "--server", "http://localhost:1234");

    expect(error).toHaveBeenCalledWith(
      JSON.stringify({ message: "Could not reach http://localhost:1234: ECONNREFUSED" }, null, 2),
    );
    expect(process.exitCode).toBe(1);
  });
});
