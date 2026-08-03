// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccessToken } from "../auth";
import { registerImages } from "./images";

// The images command group: upload drives the 3-step confirm-only flow —
// bearer POST for the upload slot, RAW PUT of the bytes to the SAS URL (no
// bearer header; content type = the extension-derived MIME the SAS pins),
// bearer POST confirm — short-circuiting on any step's failure so exactly one
// JSON object lands on exactly one stream. List maps its flags onto the query.
// Auth and fetch are mocked like in the files tests; --file reads the real
// filesystem via a temp dir.

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

const SLOT = { uploadUrl: "https://blob.example/abc.png?sas=write", blobPath: "abc.png" };
const CONFIRMED = { name: "diagram", mimeType: "image/png", byteSize: 11, credit: null };

/** Queues the happy-path responses for the three upload steps. */
function mockHappyPath(): void {
  fetchMock
    .mockResolvedValueOnce(jsonResponse(SLOT))
    .mockResolvedValueOnce(new Response(null, { status: 201 })) // blob PUT
    .mockResolvedValueOnce(jsonResponse(CONFIRMED, 201));
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

describe("images upload", () => {
  it("runs the 3-step flow: bearer slot request, raw SAS PUT, bearer confirm", async () => {
    const path = writeTempPng();
    mockHappyPath();

    await run("upload", "diagram", "--file", path, "--server", "http://localhost:1234");

    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Step 1: the bearer upload-slot request with the extension-derived MIME
    // and the real byte count.
    const [slotUrl, slotInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(slotUrl.href).toBe("http://localhost:1234/api/images/diagram");
    expect(slotInit.method).toBe("POST");
    expect((slotInit.headers as Record<string, string>).authorization).toBe("Bearer token-123");
    expect(JSON.parse(slotInit.body as string)).toEqual({
      mime: "image/png",
      byteSize: PNG_BYTES.length,
    });

    // Step 2: the raw bytes go straight to the SAS URL — no bearer header, the
    // SAS is the auth; content type must equal the requested MIME (SAS-pinned).
    const [putUrl, putInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(putUrl).toBe(SLOT.uploadUrl);
    expect(putInit.method).toBe("PUT");
    expect(putInit.headers).toEqual({ "x-ms-blob-type": "BlockBlob", "content-type": "image/png" });
    expect(Buffer.from(putInit.body as Uint8Array)).toEqual(PNG_BYTES);

    // Step 3: the bearer confirm echoes the slot's blobPath; its body is the
    // command's stdout.
    const [confirmUrl, confirmInit] = fetchMock.mock.calls[2] as [URL, RequestInit];
    expect(confirmUrl.href).toBe("http://localhost:1234/api/images/diagram/confirm");
    expect(confirmInit.method).toBe("POST");
    expect((confirmInit.headers as Record<string, string>).authorization).toBe("Bearer token-123");
    expect(JSON.parse(confirmInit.body as string)).toEqual({
      blobPath: "abc.png",
      mime: "image/png",
    });
    expect(log).toHaveBeenCalledWith(JSON.stringify(CONFIRMED, null, 2));
    expect(process.exitCode).toBeUndefined();
  });

  it("passes --credit through to the confirm body", async () => {
    const path = writeTempPng();
    mockHappyPath();

    await run("upload", "diagram", "--file", path, "--credit", "CC BY 4.0", "--server", "http://x");

    const [, confirmInit] = fetchMock.mock.calls[2] as [URL, RequestInit];
    expect(JSON.parse(confirmInit.body as string)).toEqual({
      blobPath: "abc.png",
      mime: "image/png",
      credit: "CC BY 4.0",
    });
  });

  it("URL-encodes the image name in both bearer request paths", async () => {
    const path = writeTempPng();
    mockHappyPath();

    await run("upload", "weird name", "--file", path, "--server", "http://localhost:1234");

    expect((fetchMock.mock.calls[0] as [URL])[0].href).toBe(
      "http://localhost:1234/api/images/weird%20name",
    );
    expect((fetchMock.mock.calls[2] as [URL])[0].href).toBe(
      "http://localhost:1234/api/images/weird%20name/confirm",
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

  it("prints a slot-request failure (name taken) verbatim and never PUTs or confirms", async () => {
    const path = writeTempPng();
    const body = { message: "An image with that name already exists. Choose another name." };
    fetchMock.mockResolvedValue(jsonResponse(body, 409));

    await run("upload", "diagram", "--file", path, "--server", "http://x");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(JSON.stringify(body, null, 2));
    expect(process.exitCode).toBe(1);
  });

  it("fails on an unexpected slot-response shape without PUTting", async () => {
    const path = writeTempPng();
    fetchMock.mockResolvedValue(jsonResponse({ nope: true }));

    await run("upload", "diagram", "--file", path, "--server", "http://x");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
    const printed = JSON.parse(String(error.mock.calls[0]?.[0]));
    expect(printed.message).toMatch(/unexpected response/i);
  });

  it("reports a failed storage PUT and never confirms", async () => {
    const path = writeTempPng();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(SLOT))
      .mockResolvedValueOnce(new Response("nope", { status: 403 }));

    await run("upload", "diagram", "--file", path, "--server", "http://x");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(process.exitCode).toBe(1);
    const printed = JSON.parse(String(error.mock.calls[0]?.[0]));
    expect(printed.message).toMatch(/HTTP 403/);
  });

  it("prints a confirm failure verbatim on stderr, exit 1", async () => {
    const path = writeTempPng();
    const body = { message: "The upload did not complete. Try again." };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(SLOT))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse(body, 400));

    await run("upload", "diagram", "--file", path, "--server", "http://x");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledWith(JSON.stringify(body, null, 2));
    expect(process.exitCode).toBe(1);
  });
});

describe("images list", () => {
  it("GETs with no params by default and prints the array", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ name: "diagram" }]));

    await run("list", "--server", "http://localhost:1234");

    expect((fetchMock.mock.calls[0] as [URL])[0].href).toBe("http://localhost:1234/api/images");
    expect(log).toHaveBeenCalledWith(JSON.stringify([{ name: "diagram" }], null, 2));
  });

  it("maps --search/--all onto q/mine=0", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await run("list", "--search", "gram", "--all", "--server", "http://x");

    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.searchParams.get("q")).toBe("gram");
    expect(url.searchParams.get("mine")).toBe("0");
  });
});
