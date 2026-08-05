// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccessToken, NotSignedInError } from "../auth";
import { registerCodes } from "./codes";

// The codes command group: flag → request mapping and the JSON output contract
// (success pretty-printed on stdout, every failure — auth, network, server
// rejection — as JSON on stderr with exit 1). Auth and fetch are mocked like in
// the whoami tests.
//
// `codes sync` additionally READS AND WRITES FILES (registry in, lock out), so
// its cases run in a per-test temp directory — the only CLI unit tests that
// touch the filesystem; keep that pattern inside this file.

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

describe("codes sync", () => {
  const SERVER = "http://localhost:1234";
  const QUIZ_URL = "https://example.com/course/welcome-quiz.yaml";
  const TUTOR_URL = "https://example.com/course/sorting-tutor.yaml";

  let dir: string;
  let registryPath: string;
  let lockPath: string;

  const REGISTRY = `
base-url: "https://example.com/course/"
activities:
  quizzes:
    welcome:
      file: welcome-quiz.yaml
      note: "3A"
  tutors:
    sorting:
      file: sorting-tutor.yaml
`;

  /** One row as GET /api/codes returns it. */
  function serverCode(overrides: Record<string, unknown> = {}) {
    return {
      code: "aaaaaaaaaa",
      url: "https://novedu.at/aaaaaaaaaa",
      module: "quiz",
      note: "3A",
      fileUrl: QUIZ_URL,
      anonymous: true,
      validFrom: null,
      validUntil: null,
      llm: null,
      createdBy: "teacher",
      createdAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  function lastLock(): string {
    return readFileSync(lockPath, "utf8");
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "novedu-sync-"));
    registryPath = join(dir, "activities.yaml");
    lockPath = join(dir, "activities.lock.yaml");
    writeFileSync(registryPath, REGISTRY, "utf8");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reuses a matching code, mints the rest, and writes the lock file", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([serverCode()])).mockResolvedValueOnce(
      jsonResponse(
        serverCode({
          code: "bbbbbbbbbb",
          url: "https://novedu.at/bbbbbbbbbb",
          module: "tutor",
          fileUrl: TUTOR_URL,
          note: "",
        }),
        201,
      ),
    );

    await run("sync", registryPath, "--server", SERVER);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [listUrl, listInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(listUrl.href).toBe(`${SERVER}/api/codes`);
    expect(listInit.method).toBe("GET");
    const [mintUrl, mintInit] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(mintUrl.href).toBe(`${SERVER}/api/codes`);
    expect(mintInit.method).toBe("POST");
    expect(JSON.parse(mintInit.body as string)).toEqual({
      module: "tutor",
      fileUrl: TUTOR_URL,
    });

    expect(lastLock()).toContain("activity-codes:");
    expect(lastLock()).toContain("sorting: bbbbbbbbbb");
    expect(lastLock()).toContain("welcome: aaaaaaaaaa");
    expect(process.exitCode).toBeUndefined();
  });

  it("continues after a mint failure, keeps the previous code, and exits 1", async () => {
    writeFileSync(lockPath, "activity-codes:\n  sorting: previous00\n", "utf8");
    fetchMock
      .mockResolvedValueOnce(jsonResponse([serverCode()]))
      .mockResolvedValueOnce(
        jsonResponse({ errors: [{ code: "TUTOR_SCHEMA_ERROR", message: "bad" }] }, 400),
      );

    await run("sync", registryPath, "--server", SERVER);

    expect(lastLock()).toContain("sorting: previous00");
    expect(lastLock()).toContain("welcome: aaaaaaaaaa");
    expect(process.exitCode).toBe(1);
    // The per-entry failure belongs to the report, not to the stderr contract.
    expect(error).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join("\n")).toContain("TUTOR_SCHEMA_ERROR");
  });

  it("treats an accepted mint that returns no code as a failure", async () => {
    writeFileSync(lockPath, "activity-codes:\n  sorting: previous00\n", "utf8");
    fetchMock
      .mockResolvedValueOnce(jsonResponse([serverCode()]))
      // A 201 whose body carries no code (a proxy rewrote it, say). Counting it
      // as minted would report success while the lock kept `previous00`, a code
      // that no longer describes the entry.
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 201));

    await run("sync", registryPath, "--server", SERVER);

    expect(process.exitCode).toBe(1);
    expect(log.mock.calls.flat().join("\n")).toContain("returned no code");
    expect(lastLock()).toContain("sorting: previous00");
  });

  it("keeps each key on its own code when two entries describe one activity", async () => {
    // Both entries match both codes; the lock decides which key keeps which.
    writeFileSync(
      registryPath,
      `
base-url: "https://example.com/course/"
activities:
  quizzes:
    welcome:
      file: welcome-quiz.yaml
    revision:
      file: welcome-quiz.yaml
`,
      "utf8",
    );
    writeFileSync(
      lockPath,
      "activity-codes:\n  revision: bbbbbbbbbb\n  welcome: aaaaaaaaaa\n",
      "utf8",
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        serverCode({ note: "" }),
        serverCode({ code: "bbbbbbbbbb", note: "", createdAt: "2026-06-01T00:00:00.000Z" }),
      ]),
    );

    await run("sync", registryPath, "--server", SERVER);

    // No mint: both entries reuse, and neither key moved to the newer code.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastLock()).toContain("revision: bbbbbbbbbb");
    expect(lastLock()).toContain("welcome: aaaaaaaaaa");
    expect(process.exitCode).toBeUndefined();
  });

  it("mints nothing and writes nothing with --dry-run", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([serverCode()]));

    await run("sync", registryPath, "--dry-run", "--server", SERVER);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(() => lastLock()).toThrow();
    expect(log.mock.calls.flat().join("\n")).toContain("would mint");
    expect(process.exitCode).toBeUndefined();
  });

  it("prints the machine-readable report with --json", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([serverCode()])).mockResolvedValueOnce(
      jsonResponse(
        serverCode({
          code: "bbbbbbbbbb",
          url: "https://novedu.at/bbbbbbbbbb",
          module: "tutor",
          fileUrl: TUTOR_URL,
        }),
        201,
      ),
    );

    await run("sync", registryPath, "--json", "--server", SERVER);

    const payload = JSON.parse((log.mock.calls[0] as [string])[0]);
    expect(payload.entries).toEqual([
      {
        key: "welcome",
        module: "quiz",
        fileUrl: QUIZ_URL,
        action: "reused",
        code: "aaaaaaaaaa",
        url: "https://novedu.at/aaaaaaaaaa",
      },
      {
        key: "sorting",
        module: "tutor",
        fileUrl: TUTOR_URL,
        action: "minted",
        code: "bbbbbbbbbb",
        url: "https://novedu.at/bbbbbbbbbb",
      },
    ]);
    expect(payload.warnings).toEqual([]);
  });

  it("writes the lock where --lock points, leaving the default path alone", async () => {
    const custom = join(dir, "book-codes.yaml");
    fetchMock
      .mockResolvedValueOnce(jsonResponse([serverCode()]))
      .mockResolvedValueOnce(
        jsonResponse(serverCode({ code: "bbbbbbbbbb", module: "tutor" }), 201),
      );

    await run("sync", registryPath, "--lock", custom, "--server", SERVER);

    expect(readFileSync(custom, "utf8")).toContain("welcome: aaaaaaaaaa");
    expect(() => lastLock()).toThrow();
  });

  it("reports a lock key that left the registry and drops it from the rewritten lock", async () => {
    writeFileSync(lockPath, "activity-codes:\n  gone: cccccccccc\n", "utf8");
    fetchMock
      .mockResolvedValueOnce(jsonResponse([serverCode()]))
      .mockResolvedValueOnce(
        jsonResponse(serverCode({ code: "bbbbbbbbbb", module: "tutor" }), 201),
      );

    await run("sync", registryPath, "--server", SERVER);

    expect(log.mock.calls.flat().join("\n")).toContain("gone");
    expect(lastLock()).not.toContain("gone");
  });

  it("rejects an invalid registry as JSON on stderr, before any request", async () => {
    writeFileSync(registryPath, "activities:\n  quizes:\n    x:\n      url: https://x/q.yaml\n");

    await run("sync", registryPath, "--server", SERVER);

    expect(fetchMock).not.toHaveBeenCalled();
    const payload = JSON.parse((error.mock.calls[0] as [string])[0]);
    expect(payload.errors[0].path).toBe("activities.quizes");
    expect(process.exitCode).toBe(1);
  });

  it("reports an unreadable registry file without fetching", async () => {
    await run("sync", join(dir, "missing.yaml"), "--server", SERVER);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse((error.mock.calls[0] as [string])[0]).errors[0].code).toBe(
      "REGISTRY_READ_ERROR",
    );
    expect(process.exitCode).toBe(1);
  });

  it("reports not-signed-in as JSON on stderr without fetching, and writes no lock", async () => {
    vi.mocked(getAccessToken).mockRejectedValue(new NotSignedInError());

    await run("sync", registryPath, "--server", SERVER);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      JSON.stringify({ message: 'Not signed in — run "novedu-cli login".' }, null, 2),
    );
    expect(() => lastLock()).toThrow();
    expect(process.exitCode).toBe(1);
  });

  it("aborts when the code listing fails — nothing minted, no lock written", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await run("sync", registryPath, "--server", SERVER);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(() => lastLock()).toThrow();
    expect(process.exitCode).toBe(1);
  });
});
