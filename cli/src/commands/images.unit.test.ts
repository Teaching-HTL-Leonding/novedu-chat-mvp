// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccessToken } from "../auth";
import { registerImages } from "./images";

// The images command group: upload is now ONE multipart POST — bearer auth,
// the bytes as a `file` part (with a filename), `mime` and an optional
// `credit` field, no upload slot and no separate confirm step. List maps its
// flags onto the query. Auth and fetch are mocked like in the files tests;
// --file reads the real filesystem via a temp dir.

vi.mock("../auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth")>();
  return { ...actual, getAccessToken: vi.fn() };
});

const fetchMock = vi.fn();

function run(...args: string[]): Promise<Command> {
  const program = new Command();
  registerImages(program);
  return program.parseAsync(["images", ...args], { from: "user" });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function writeTempPng(): string {
  const path = join(mkdtempSync(join(tmpdir(), "cli-images-test-")), "diagram.png");
  writeFileSync(path, PNG_BYTES);
  return path;
}

const CREATED = { id: "img-1", name: "diagram", mimeType: "image/png", byteSize: 11, credit: null };

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

describe("images upload", () => {
  it("makes ONE bearer multipart request with the bytes, mime and no credit field", async () => {
    const path = writeTempPng();
    fetchMock.mockResolvedValueOnce(jsonResponse(CREATED, 201));

    await run("upload", "diagram", "--file", path, "--server", "http://localhost:1234");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe("http://localhost:1234/api/images/diagram");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token-123");
    // No content-type set by the CLI — fetch derives the multipart boundary
    // from the FormData body itself.
    expect((init.headers as Record<string, string>)["content-type"]).toBeUndefined();

    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    const file = form.get("file") as File;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("diagram.png");
    expect(file.type).toBe("image/png");
    expect(Buffer.from(await file.arrayBuffer())).toEqual(PNG_BYTES);
    expect(form.get("mime")).toBe("image/png");
    expect(form.get("credit")).toBeNull();
    expect(form.getAll("file")).toHaveLength(1);

    expect(log).toHaveBeenCalledWith(JSON.stringify(CREATED, null, 2));
    expect(process.exitCode).toBeUndefined();
  });

  it("passes --credit through as a form field", async () => {
    const path = writeTempPng();
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...CREATED, credit: "CC BY 4.0" }, 201));

    await run("upload", "diagram", "--file", path, "--credit", "CC BY 4.0", "--server", "http://x");

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const form = init.body as FormData;
    expect(form.get("credit")).toBe("CC BY 4.0");
  });

  it("URL-encodes the image name in the request path", async () => {
    const path = writeTempPng();
    fetchMock.mockResolvedValueOnce(jsonResponse(CREATED, 201));

    await run("upload", "weird name", "--file", path, "--server", "http://localhost:1234");

    expect((fetchMock.mock.calls[0] as [URL])[0].href).toBe(
      "http://localhost:1234/api/images/weird%20name",
    );
  });

  it("requires --file (no stdin for binary) without fetching", async () => {
    await run("upload", "diagram", "--server", "http://x");

    expect(process.exitCode).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    const printed = JSON.parse(String(error.mock.calls[0]?.[0]));
    expect(printed.message).toMatch(/--file/);
  });

  it("rejects an extension outside png/jpg/jpeg/svg without fetching", async () => {
    await run("upload", "diagram", "--file", "/tmp/animation.gif", "--server", "http://x");

    expect(process.exitCode).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    const printed = JSON.parse(String(error.mock.calls[0]?.[0]));
    expect(printed.message).toMatch(/\.png, \.jpg\/\.jpeg and \.svg/);
  });

  it("reports an unreadable --file path as JSON on stderr without fetching", async () => {
    await run("upload", "diagram", "--file", "/no/such/diagram.png", "--server", "http://x");

    expect(process.exitCode).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    const printed = JSON.parse(String(error.mock.calls[0]?.[0]));
    expect(printed.message).toMatch(/\/no\/such\/diagram\.png/);
  });

  it("prints a 409 (name taken) verbatim on stderr, exit 1", async () => {
    const path = writeTempPng();
    const body = { message: "An image with that name already exists. Choose another name." };
    fetchMock.mockResolvedValue(jsonResponse(body, 409));

    await run("upload", "diagram", "--file", path, "--server", "http://x");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(JSON.stringify(body, null, 2));
    expect(process.exitCode).toBe(1);
  });

  it("prints a 503 (storage unavailable) verbatim on stderr, exit 1", async () => {
    const path = writeTempPng();
    const body = { message: "Image storage is unavailable right now. Try again later." };
    fetchMock.mockResolvedValue(jsonResponse(body, 503));

    await run("upload", "diagram", "--file", path, "--server", "http://x");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(JSON.stringify(body, null, 2));
    expect(process.exitCode).toBe(1);
  });
});

describe("images list", () => {
  it("GETs with no params by default and prints the array", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: "img-1", name: "diagram" }]));

    await run("list", "--server", "http://localhost:1234");

    expect((fetchMock.mock.calls[0] as [URL])[0].href).toBe("http://localhost:1234/api/images");
    expect(log).toHaveBeenCalledWith(JSON.stringify([{ id: "img-1", name: "diagram" }], null, 2));
  });

  it("maps --search/--all onto q/mine=0", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await run("list", "--search", "gram", "--all", "--server", "http://x");

    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.searchParams.get("q")).toBe("gram");
    expect(url.searchParams.get("mine")).toBe("0");
  });
});
