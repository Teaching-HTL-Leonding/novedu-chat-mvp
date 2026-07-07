// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccessToken } from "../auth";
import { registerFiles } from "./files";

// The files command group: upload reads YAML from --file or stdin and PUTs the
// upsert body (kind only when given), list maps its flags onto the query.
// Failures follow the JSON-on-stderr contract. Auth and fetch are mocked like
// in the whoami tests; --file reads the real filesystem via a temp dir.

vi.mock("../auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth")>();
  return { ...actual, getAccessToken: vi.fn() };
});

const fetchMock = vi.fn();

function run(...args: string[]): Promise<Command> {
  const program = new Command();
  registerFiles(program);
  return program.parseAsync(["files", ...args], { from: "user" });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Swaps process.stdin for a readable emitting `text` for one test. */
function stubStdin(text: string): () => void {
  const original = Object.getOwnPropertyDescriptor(process, "stdin");
  Object.defineProperty(process, "stdin", {
    value: Readable.from([Buffer.from(text, "utf8")]),
    configurable: true,
  });
  return () => {
    if (original) Object.defineProperty(process, "stdin", original);
  };
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

describe("files upload", () => {
  it("PUTs the YAML from --file with the kind and prints the result", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "cli-files-test-")), "quiz.yaml");
    writeFileSync(path, "id: q\n");
    const result = {
      name: "my-quiz",
      kind: "quiz",
      url: "https://app/api/files/my-quiz",
      action: "created",
    };
    fetchMock.mockResolvedValue(jsonResponse(result));

    await run(
      "upload",
      "my-quiz",
      "--kind",
      "quiz",
      "--file",
      path,
      "--server",
      "http://localhost:1234",
    );

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe("http://localhost:1234/api/files/my-quiz");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token-123");
    expect(JSON.parse(init.body as string)).toEqual({ kind: "quiz", content: "id: q\n" });
    expect(log).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
    expect(process.exitCode).toBeUndefined();
  });

  it("reads from stdin and omits kind when not given (update path)", async () => {
    const restore = stubStdin("id: q2\n");
    fetchMock.mockResolvedValue(jsonResponse({ action: "updated" }));
    try {
      await run("upload", "my-quiz", "--server", "http://localhost:1234");
    } finally {
      restore();
    }

    expect(JSON.parse((fetchMock.mock.calls[0] as [URL, RequestInit])[1].body as string)).toEqual({
      content: "id: q2\n",
    });
  });

  it("URL-encodes the file name in the request path", async () => {
    const restore = stubStdin("id: x\n");
    fetchMock.mockResolvedValue(jsonResponse({}));
    try {
      await run("upload", "weird name", "--server", "http://localhost:1234");
    } finally {
      restore();
    }
    expect((fetchMock.mock.calls[0] as [URL])[0].href).toBe(
      "http://localhost:1234/api/files/weird%20name",
    );
  });

  it("prints the server's kind-mismatch verbatim on stderr, exit 1", async () => {
    const restore = stubStdin("id: x\n");
    const body = { message: '"my-quiz" is stored as a tutor file, not quiz.' };
    fetchMock.mockResolvedValue(jsonResponse(body, 409));
    try {
      await run("upload", "my-quiz", "--kind", "quiz", "--server", "http://x");
    } finally {
      restore();
    }

    expect(error).toHaveBeenCalledWith(JSON.stringify(body, null, 2));
    expect(process.exitCode).toBe(1);
  });

  it("reports an unreadable --file path as JSON on stderr without fetching", async () => {
    await run("upload", "my-quiz", "--file", "/no/such/file.yaml", "--server", "http://x");

    expect(process.exitCode).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    const printed = JSON.parse(String(error.mock.calls[0]?.[0]));
    expect(printed.message).toMatch(/\/no\/such\/file\.yaml/);
  });
});

describe("files list", () => {
  it("GETs with no params by default and prints the array", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ name: "my-quiz" }]));

    await run("list", "--server", "http://localhost:1234");

    expect((fetchMock.mock.calls[0] as [URL])[0].href).toBe("http://localhost:1234/api/files");
    expect(log).toHaveBeenCalledWith(JSON.stringify([{ name: "my-quiz" }], null, 2));
  });

  it("maps --search/--all onto q/mine=0", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await run("list", "--search", "quiz", "--all", "--server", "http://x");

    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.searchParams.get("q")).toBe("quiz");
    expect(url.searchParams.get("mine")).toBe("0");
  });
});
