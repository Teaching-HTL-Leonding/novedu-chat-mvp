// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The bearer multipart upload route: real auth gate over a stubbed
// `getSession`, the REAL bounded multipart reader (spied so the auth-before-body
// order can be asserted), mocked service. Every request here carries actual
// multipart bytes. Pins the 401/403 matrix WITHOUT a body read, the field
// checks, the two byte bounds (the fast `Content-Length` reject and the
// authoritative streamed counter), the service reason → status mapping, and the
// 201 wire shape.

const mocks = vi.hoisted(() => ({
  createImageForUser: vi.fn(),
  readBoundedFormData: vi.fn(),
}));

vi.mock("@/lib/image-service", () => ({ createImageForUser: mocks.createImageForUser }));
vi.mock("@/lib/bounded-form", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bounded-form")>();
  mocks.readBoundedFormData.mockImplementation(actual.readBoundedFormData);
  return { readBoundedFormData: mocks.readBoundedFormData };
});

vi.mock("@/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

import { auth } from "@/auth";
import { bearerSession } from "@/tests/mock-auth-session";
import { POST } from "./route";

const getSession = vi.mocked(auth.api.getSession);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function mint(teacher = true): string {
  getSession.mockResolvedValue(
    bearerSession({ id: "teacher-oid-1", name: "Test Teacher", isTeacher: teacher }),
  );
  return "session-token";
}

function uploadForm(
  overrides: {
    file?: File | string | null;
    extraFile?: File;
    mime?: string | null;
    extraMime?: string;
    credit?: string;
    extraCredit?: string;
    bytes?: number;
  } = {},
): FormData {
  const form = new FormData();
  if (overrides.file !== null) {
    form.append(
      "file",
      overrides.file ??
        new File([new Uint8Array(overrides.bytes ?? 8)], "red.png", { type: "image/png" }),
    );
  }
  if (overrides.extraFile) form.append("file", overrides.extraFile);
  if (overrides.mime !== null) form.append("mime", overrides.mime ?? "image/png");
  if (overrides.extraMime) form.append("mime", overrides.extraMime);
  if (overrides.credit !== undefined) form.append("credit", overrides.credit);
  if (overrides.extraCredit) form.append("credit", overrides.extraCredit);
  return form;
}

function post(name: string, body: BodyInit | null, token?: string, headers?: HeadersInit) {
  const init: RequestInit = {
    method: "POST",
    body,
    headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...headers,
    },
  };
  return POST(new Request(`http://localhost/api/images/${encodeURIComponent(name)}`, init), {
    params: Promise.resolve({ name }),
  });
}

/** A chunked body with no Content-Length — only the streamed counter can catch it. */
function chunked(totalBytes: number, contentType: string): Request {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(64 * 1024, totalBytes - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size));
    },
  });
  return new Request("http://localhost/api/images/diagram", {
    method: "POST",
    body: stream,
    headers: { authorization: "Bearer session-token", "content-type": contentType },
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockReset();
  getSession.mockResolvedValue(null);
  mocks.createImageForUser.mockResolvedValue({
    ok: true,
    id: "row-1",
    name: "diagram",
    mimeType: "image/png",
    byteSize: 8,
    credit: null,
  });
});

describe("POST /api/images/<name> auth", () => {
  it("401s without a token, with WWW-Authenticate and NO body read", async () => {
    const res = await post("diagram", uploadForm());
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(mocks.readBoundedFormData).not.toHaveBeenCalled();
    expect(mocks.createImageForUser).not.toHaveBeenCalled();
  });

  it("403s a valid non-teacher token with NO body read", async () => {
    const res = await post("diagram", uploadForm(), mint(false));
    expect(res.status).toBe(403);
    expect(mocks.readBoundedFormData).not.toHaveBeenCalled();
    expect(mocks.createImageForUser).not.toHaveBeenCalled();
  });
});

describe("POST /api/images/<name> body validation", () => {
  it("400s a non-multipart body", async () => {
    const res = await post("diagram", JSON.stringify({ mime: "image/png" }), mint(), {
      "content-type": "application/json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "The request body must be multipart/form-data." });
    expect(mocks.createImageForUser).not.toHaveBeenCalled();
  });

  it("400s an empty body", async () => {
    const res = await post("diagram", null, mint(), {
      "content-type": "multipart/form-data; boundary=----abc",
    });
    expect(res.status).toBe(400);
    expect(mocks.createImageForUser).not.toHaveBeenCalled();
  });

  it("400s a malformed multipart body", async () => {
    const res = await post("diagram", "------abc\r\nContent-Disposition: form-data;", mint(), {
      "content-type": "multipart/form-data; boundary=----abc",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: "The request body is not valid multipart/form-data.",
    });
  });

  it("400s a missing file part", async () => {
    const res = await post("diagram", uploadForm({ file: null }), mint());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: "file must be sent exactly once as a file part.",
    });
    expect(mocks.createImageForUser).not.toHaveBeenCalled();
  });

  it("400s a duplicate file part", async () => {
    const res = await post(
      "diagram",
      uploadForm({ extraFile: new File([new Uint8Array(4)], "b.png", { type: "image/png" }) }),
      mint(),
    );
    expect(res.status).toBe(400);
    expect(mocks.createImageForUser).not.toHaveBeenCalled();
  });

  it("400s a file sent as a plain string field", async () => {
    const res = await post("diagram", uploadForm({ file: "not-a-file" }), mint());
    expect(res.status).toBe(400);
    expect(mocks.createImageForUser).not.toHaveBeenCalled();
  });

  it("400s a missing mime field", async () => {
    const res = await post("diagram", uploadForm({ mime: null }), mint());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: "mime must be sent exactly once (image/png, image/jpeg or image/svg+xml).",
    });
  });

  it("400s a duplicate mime field", async () => {
    const res = await post("diagram", uploadForm({ extraMime: "image/jpeg" }), mint());
    expect(res.status).toBe(400);
    expect(mocks.createImageForUser).not.toHaveBeenCalled();
  });

  it("400s a duplicate credit field", async () => {
    const res = await post("diagram", uploadForm({ credit: "a", extraCredit: "b" }), mint());
    expect(res.status).toBe(400);
    expect(mocks.createImageForUser).not.toHaveBeenCalled();
  });
});

describe("POST /api/images/<name> byte bounds", () => {
  it("413s on the fast path when Content-Length claims more than 6 MiB", async () => {
    // The body itself is tiny: only the LYING header can produce this rejection,
    // which proves the fast path ran before the body was read.
    const res = await post("diagram", uploadForm(), mint(), {
      "content-length": String(7 * 1024 * 1024),
    });
    expect(res.status).toBe(413);
    expect(mocks.readBoundedFormData).not.toHaveBeenCalled();
  });

  it("413s a chunked 6 MiB+ body that declares no Content-Length", async () => {
    mint();
    const request = chunked(7 * 1024 * 1024, "multipart/form-data; boundary=----abc");
    expect(request.headers.get("content-length")).toBeNull();
    const res = await POST(request, { params: Promise.resolve({ name: "diagram" }) });
    expect(res.status).toBe(413);
    expect(mocks.createImageForUser).not.toHaveBeenCalled();
  });

  it("413s from the counter when Content-Length lies low", async () => {
    mint();
    const request = chunked(7 * 1024 * 1024, "multipart/form-data; boundary=----abc");
    request.headers.set("content-length", "10");
    const res = await POST(request, { params: Promise.resolve({ name: "diagram" }) });
    expect(res.status).toBe(413);
  });

  it("hands a file of exactly 5 MiB to the service", async () => {
    const res = await post("diagram", uploadForm({ bytes: MAX_IMAGE_BYTES }), mint());
    expect(res.status).toBe(201);
    const call = mocks.createImageForUser.mock.calls[0];
    if (!call) throw new Error("the service was never called");
    expect(call[1].content.size).toBe(MAX_IMAGE_BYTES);
  });
});

describe("POST /api/images/<name>", () => {
  it("passes the path name, MIME, credit and bytes to the service and answers 201", async () => {
    mocks.createImageForUser.mockResolvedValue({
      ok: true,
      id: "row-42",
      name: "my-diagram",
      mimeType: "image/png",
      byteSize: 8,
      credit: "CC BY 4.0",
    });
    const res = await post("my-diagram", uploadForm({ credit: "CC BY 4.0" }), mint());

    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const call = mocks.createImageForUser.mock.calls[0];
    if (!call) throw new Error("the service was never called");
    const [userId, input] = call;
    expect(userId).toBe("teacher-oid-1");
    expect(input.name).toBe("my-diagram");
    expect(input.mime).toBe("image/png");
    expect(input.credit).toBe("CC BY 4.0");
    expect(new Uint8Array(await input.content.arrayBuffer())).toEqual(new Uint8Array(8));
    expect(await res.json()).toEqual({
      id: "row-42",
      name: "my-diagram",
      mimeType: "image/png",
      byteSize: 8,
      credit: "CC BY 4.0",
    });
  });

  it("maps invalid → 400 with the service message", async () => {
    mocks.createImageForUser.mockResolvedValue({
      ok: false,
      reason: "invalid",
      message: "The image is too large — the maximum is 5 MB.",
    });
    const res = await post("diagram", uploadForm(), mint());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "The image is too large — the maximum is 5 MB." });
  });

  it("maps conflict (name taken) → 409", async () => {
    mocks.createImageForUser.mockResolvedValue({
      ok: false,
      reason: "conflict",
      message: "An image with that name already exists. Choose another name.",
    });
    const res = await post("diagram", uploadForm(), mint());
    expect(res.status).toBe(409);
  });

  it("maps unavailable → 503", async () => {
    mocks.createImageForUser.mockResolvedValue({
      ok: false,
      reason: "unavailable",
      message: "Image storage is unavailable right now. Try again later.",
    });
    const res = await post("diagram", uploadForm(), mint());
    expect(res.status).toBe(503);
  });
});
