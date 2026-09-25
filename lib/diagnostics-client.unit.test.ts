// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The telemetry read seam: never throws, maps every failure to a typed one, and
// never logs a secret. `fetch` and the Entra token provider are mocked; the module
// is re-imported per test so its cached token provider starts fresh.

const mocks = vi.hoisted(() => ({
  getBearerTokenProvider: vi.fn(),
  recordError: vi.fn(),
}));

vi.mock("@azure/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@azure/identity")>();
  return { ...actual, getBearerTokenProvider: mocks.getBearerTokenProvider };
});
vi.mock("@/lib/telemetry", () => ({ recordError: mocks.recordError }));

const TOKEN = "fake-entra-token-abc";
const CONNECTION =
  "InstrumentationKey=ikey-123;IngestionEndpoint=https://example.in.applicationinsights.azure.com/;ApplicationId=app-guid-42";
const WINDOW = { from: new Date("2026-09-25T07:00:00Z"), to: new Date("2026-09-25T08:00:00Z") };

const TABLE = {
  name: "PrimaryResult",
  columns: [{ name: "t", type: "datetime" }],
  rows: [["2026-09-25T07:00:00Z"]],
};

async function load() {
  vi.resetModules();
  return import("@/lib/diagnostics-client");
}

let consoleError: ReturnType<typeof vi.spyOn>;
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APPLICATIONINSIGHTS_CONNECTION_STRING", CONNECTION);
  vi.stubGlobal("fetch", fetchMock);
  mocks.getBearerTokenProvider.mockReturnValue(vi.fn().mockResolvedValue(TOKEN));
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  consoleError.mockRestore();
});

function logged(): string {
  return JSON.stringify(consoleError.mock.calls);
}

describe("parseApplicationId", () => {
  it("reads the key case-insensitively and trims it", async () => {
    const { parseApplicationId } = await load();
    expect(parseApplicationId(CONNECTION)).toBe("app-guid-42");
    expect(parseApplicationId("applicationid = abc ;InstrumentationKey=x")).toBe("abc");
    expect(parseApplicationId("InstrumentationKey=x")).toBeUndefined();
    expect(parseApplicationId("ApplicationId=")).toBeUndefined();
    expect(parseApplicationId(undefined)).toBeUndefined();
  });
});

describe("not configured", () => {
  it("never calls Azure without a connection string", async () => {
    vi.stubEnv("APPLICATIONINSIGHTS_CONNECTION_STRING", "");
    const { diagnosticsConfigured, runDiagnosticsQuery } = await load();
    expect(diagnosticsConfigured()).toBe(false);
    expect(await runDiagnosticsQuery("llmCalls", "q", WINDOW)).toEqual({
      ok: false,
      failure: "not-configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.getBearerTokenProvider).not.toHaveBeenCalled();
    expect(mocks.recordError).not.toHaveBeenCalled();
  });

  it("never calls Azure without an ApplicationId", async () => {
    vi.stubEnv("APPLICATIONINSIGHTS_CONNECTION_STRING", "InstrumentationKey=ikey-123");
    const { diagnosticsConfigured, runDiagnosticsQuery } = await load();
    expect(diagnosticsConfigured()).toBe(false);
    expect((await runDiagnosticsQuery("llmCalls", "q", WINDOW)).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("success", () => {
  it("posts the query and timespan with a bearer token and returns the first table", async () => {
    fetchMock.mockResolvedValue(Response.json({ tables: [TABLE] }));
    const { runDiagnosticsQuery, MONITOR_SCOPE } = await load();
    const result = await runDiagnosticsQuery("chatTurns", "requests | take 1", WINDOW);
    expect(result).toEqual({ ok: true, table: TABLE });

    expect(mocks.getBearerTokenProvider).toHaveBeenCalledWith(expect.anything(), MONITOR_SCOPE);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.applicationinsights.io/v1/apps/app-guid-42/query");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body)).toEqual({
      query: "requests | take 1",
      timespan: "2026-09-25T07:00:00.000Z/2026-09-25T08:00:00.000Z",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("creates the token provider once per process", async () => {
    fetchMock.mockImplementation(async () => Response.json({ tables: [TABLE] }));
    const { runDiagnosticsQuery } = await load();
    await runDiagnosticsQuery("llmCalls", "q", WINDOW);
    await runDiagnosticsQuery("chatTurns", "q", WINDOW);
    expect(mocks.getBearerTokenProvider).toHaveBeenCalledTimes(1);
  });
});

describe("failures", () => {
  it("maps a token failure to credential without calling the API", async () => {
    mocks.getBearerTokenProvider.mockReturnValue(
      vi.fn().mockRejectedValue(new Error("Please run 'az login'")),
    );
    const { runDiagnosticsQuery } = await load();
    expect(await runDiagnosticsQuery("llmCalls", "q", WINDOW)).toEqual({
      ok: false,
      failure: "credential",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.recordError).toHaveBeenCalledWith(expect.any(Error), {
      "novedu.area": "diagnostics",
      "novedu.diagnostics.query": "llmCalls",
      "novedu.diagnostics.failure": "credential",
    });
  });

  it.each([401, 403])("maps HTTP %i to forbidden", async (status) => {
    fetchMock.mockResolvedValue(
      Response.json({ error: { code: "InsufficientAccessError", message: "no" } }, { status }),
    );
    const { runDiagnosticsQuery } = await load();
    expect(await runDiagnosticsQuery("llmCalls", "q", WINDOW)).toEqual({
      ok: false,
      failure: "forbidden",
    });
  });

  it("maps another HTTP error to error", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: { code: "BadArgumentError", message: "syntax" } }, { status: 400 }),
    );
    const { runDiagnosticsQuery } = await load();
    expect(await runDiagnosticsQuery("llmCalls", "q", WINDOW)).toEqual({
      ok: false,
      failure: "error",
    });
    expect(logged()).toContain("BadArgumentError");
  });

  it("maps a timeout to timeout", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    const { runDiagnosticsQuery } = await load();
    expect(await runDiagnosticsQuery("llmCalls", "q", WINDOW)).toEqual({
      ok: false,
      failure: "timeout",
    });
  });

  it("maps a network failure to error", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const { runDiagnosticsQuery } = await load();
    expect(await runDiagnosticsQuery("llmCalls", "q", WINDOW)).toEqual({
      ok: false,
      failure: "error",
    });
  });

  it.each([
    ["not JSON", new Response("<html>", { status: 200 })],
    ["no tables", Response.json({ tables: [] })],
    ["no rows", Response.json({ tables: [{ columns: [] }] })],
  ])("maps a malformed body (%s) to error", async (_label, response) => {
    fetchMock.mockResolvedValue(response);
    const { runDiagnosticsQuery } = await load();
    expect(await runDiagnosticsQuery("llmCalls", "q", WINDOW)).toEqual({
      ok: false,
      failure: "error",
    });
  });

  it("never logs the token, the connection string or the app id", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { code: "X" } }, { status: 500 }));
    const { runDiagnosticsQuery } = await load();
    await runDiagnosticsQuery("llmCalls", "q", WINDOW);
    expect(consoleError).toHaveBeenCalled();
    const text = logged();
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("ikey-123");
    expect(text).not.toContain("app-guid-42");
  });
});
