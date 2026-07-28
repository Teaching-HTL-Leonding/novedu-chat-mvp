// @vitest-environment node
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccessToken, NotSignedInError } from "../auth";
import { registerReports } from "./reports";

// The reports command group: flag → request mapping for the three subcommands
// and the JSON output contract (success pretty-printed on stdout, every failure
// — auth, network, server rejection — as JSON on stderr with exit 1). Auth and
// fetch are mocked like in the codes/whoami tests.

vi.mock("../auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth")>();
  return { ...actual, getAccessToken: vi.fn() };
});

const fetchMock = vi.fn();

function run(...args: string[]): Promise<Command> {
  const program = new Command();
  registerReports(program);
  return program.parseAsync(["reports", ...args], { from: "user" });
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

describe("reports list", () => {
  it("GETs with no params by default (open, my codes) and prints the array", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: "r1" }]));

    await run("list", "--server", "http://localhost:1234");

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe("http://localhost:1234/api/reports");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token-123");
    expect(log).toHaveBeenCalledWith(JSON.stringify([{ id: "r1" }], null, 2));
    expect(process.exitCode).toBeUndefined();
  });

  it("passes --status/--reaction/--search through verbatim and maps --all onto mine=0", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await run(
      "list",
      "--status",
      "resolved",
      "--reaction",
      "holysh",
      "--search",
      "typo",
      "--all",
      "--server",
      "http://x",
    );

    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.searchParams.get("status")).toBe("resolved");
    expect(url.searchParams.get("reaction")).toBe("holysh");
    expect(url.searchParams.get("q")).toBe("typo");
    expect(url.searchParams.get("mine")).toBe("0");
  });

  it("passes an unknown --status through unvalidated and surfaces the server's 400 on stderr", async () => {
    const body = { message: "Unknown status" };
    fetchMock.mockResolvedValue(jsonResponse(body, 400));

    await run("list", "--status", "bogus", "--server", "http://x");

    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.searchParams.get("status")).toBe("bogus");
    expect(error).toHaveBeenCalledWith(JSON.stringify(body, null, 2));
    expect(process.exitCode).toBe(1);
    expect(log).not.toHaveBeenCalled();
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

describe("reports show", () => {
  it("GETs /api/reports/<id> with the id URL-encoded and prints the report", async () => {
    const report = {
      id: "r1",
      kind: "chat",
      messages: [{ id: "m1", role: "user", content: "hi" }],
    };
    fetchMock.mockResolvedValue(jsonResponse(report));

    await run("show", "a b/c", "--server", "http://localhost:1234");

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe("http://localhost:1234/api/reports/a%20b%2Fc");
    expect(init.method).toBe("GET");
    expect(log).toHaveBeenCalledWith(JSON.stringify(report, null, 2));
  });

  it("surfaces the server's 404 on stderr, exit 1", async () => {
    const body = { message: "Not found" };
    fetchMock.mockResolvedValue(jsonResponse(body, 404));

    await run("show", "missing", "--server", "http://x");

    expect(error).toHaveBeenCalledWith(JSON.stringify(body, null, 2));
    expect(process.exitCode).toBe(1);
    expect(log).not.toHaveBeenCalled();
  });

  it("reports not-signed-in as JSON on stderr, exit 1, without fetching", async () => {
    vi.mocked(getAccessToken).mockRejectedValue(new NotSignedInError());

    await run("show", "r1");

    expect(error).toHaveBeenCalledWith(
      JSON.stringify({ message: 'Not signed in — run "novedu-cli login".' }, null, 2),
    );
    expect(process.exitCode).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("reports resolve", () => {
  it("POSTs all ids in one request body and prints the result", async () => {
    const result = { ok: true };
    fetchMock.mockResolvedValue(jsonResponse(result));

    await run("resolve", "r1", "r2", "r3", "--server", "http://localhost:1234");

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe("http://localhost:1234/api/reports/resolve");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ ids: ["r1", "r2", "r3"] });
    expect(log).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
    expect(process.exitCode).toBeUndefined();
  });

  it("passes a bad id through unvalidated and surfaces the server's 400 on stderr", async () => {
    const body = { message: "ids must be non-empty UUIDs" };
    fetchMock.mockResolvedValue(jsonResponse(body, 400));

    await run("resolve", "not-a-uuid", "--server", "http://x");

    expect(JSON.parse((fetchMock.mock.calls[0] as [URL, RequestInit])[1].body as string)).toEqual({
      ids: ["not-a-uuid"],
    });
    expect(error).toHaveBeenCalledWith(JSON.stringify(body, null, 2));
    expect(process.exitCode).toBe(1);
  });
});
