// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The bearer request-upload route (step 1 of the confirm-only flow): real auth
// gate over a stubbed `getSession`, mocked service. Pins the 401/403 matrix,
// the body type-check 400s, the service reason → status mapping
// (invalid→400, conflict→409, unavailable→503), and the wire shape.

const mocks = vi.hoisted(() => ({
  prepareImageUpload: vi.fn(),
}));

vi.mock("@/lib/image-service", () => ({ prepareImageUpload: mocks.prepareImageUpload }));

vi.mock("@/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

import { auth } from "@/auth";
import { bearerSession } from "@/tests/mock-auth-session";
import { POST } from "./route";

const getSession = vi.mocked(auth.api.getSession);

async function mint(teacher = true): Promise<string> {
  getSession.mockResolvedValue(
    bearerSession({ id: "teacher-oid-1", name: "Test Teacher", isTeacher: teacher }),
  );
  return "session-token";
}

async function postRequest(name: string, body: unknown, token?: string): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/images/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ name }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockReset();
  getSession.mockResolvedValue(null);
  mocks.prepareImageUpload.mockResolvedValue({
    ok: true,
    uploadUrl: "https://blob.example/abc.png?sas=write",
    blobPath: "abc.png",
  });
});

describe("POST /api/images/<name> auth", () => {
  it("401s without a token, with WWW-Authenticate", async () => {
    const res = await postRequest("diagram", { mime: "image/png", byteSize: 100 });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(mocks.prepareImageUpload).not.toHaveBeenCalled();
  });

  it("403s a valid non-teacher token", async () => {
    const res = await postRequest(
      "diagram",
      { mime: "image/png", byteSize: 100 },
      await mint(false),
    );
    expect(res.status).toBe(403);
    expect(mocks.prepareImageUpload).not.toHaveBeenCalled();
  });
});

describe("POST /api/images/<name> body validation", () => {
  it("400s a non-JSON body", async () => {
    const res = await postRequest("diagram", "not json", await mint());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "The request body must be JSON." });
    expect(mocks.prepareImageUpload).not.toHaveBeenCalled();
  });

  it("400s a non-object body", async () => {
    const res = await postRequest("diagram", JSON.stringify("hi"), await mint());
    expect(res.status).toBe(400);
    expect(mocks.prepareImageUpload).not.toHaveBeenCalled();
  });

  it("400s a missing/non-string mime", async () => {
    const res = await postRequest("diagram", { byteSize: 100 }, await mint());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: "mime must be a string (image/png, image/jpeg or image/svg+xml).",
    });
    expect(mocks.prepareImageUpload).not.toHaveBeenCalled();
  });

  it("400s a missing/non-number byteSize", async () => {
    const res = await postRequest("diagram", { mime: "image/png", byteSize: "big" }, await mint());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: "byteSize must be a number (the image size in bytes).",
    });
    expect(mocks.prepareImageUpload).not.toHaveBeenCalled();
  });
});

describe("POST /api/images/<name>", () => {
  it("passes the path name through and returns the upload slot", async () => {
    const res = await postRequest("my-diagram", { mime: "image/png", byteSize: 100 }, await mint());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.prepareImageUpload).toHaveBeenCalledWith({
      name: "my-diagram",
      mime: "image/png",
      byteSize: 100,
    });
    expect(await res.json()).toEqual({
      uploadUrl: "https://blob.example/abc.png?sas=write",
      blobPath: "abc.png",
    });
  });

  it("maps invalid → 400 with the service message", async () => {
    mocks.prepareImageUpload.mockResolvedValue({
      ok: false,
      reason: "invalid",
      message: "The image is too large — the maximum is 5 MB.",
    });
    const res = await postRequest("diagram", { mime: "image/png", byteSize: 1 }, await mint());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "The image is too large — the maximum is 5 MB." });
  });

  it("maps conflict (name taken) → 409", async () => {
    mocks.prepareImageUpload.mockResolvedValue({
      ok: false,
      reason: "conflict",
      message: "An image with that name already exists. Choose another name.",
    });
    const res = await postRequest("diagram", { mime: "image/png", byteSize: 1 }, await mint());
    expect(res.status).toBe(409);
  });

  it("maps unavailable → 503", async () => {
    mocks.prepareImageUpload.mockResolvedValue({
      ok: false,
      reason: "unavailable",
      message: "The name could not be checked right now — try again.",
    });
    const res = await postRequest("diagram", { mime: "image/png", byteSize: 1 }, await mint());
    expect(res.status).toBe(503);
  });
});
