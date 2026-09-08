// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The bearer confirm route (step 3 of the confirm-only flow): real auth gate
// over a stubbed `getSession`, mocked service. Pins the 401/403 matrix, the
// body type-check 400s, that the VERIFIED bearer user id (oid) is what reaches
// the service, the reason → status mapping, and the 201 wire shape.

const mocks = vi.hoisted(() => ({
  confirmImageUploadForUser: vi.fn(),
}));

vi.mock("@/lib/image-service", () => ({
  confirmImageUploadForUser: mocks.confirmImageUploadForUser,
}));

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
    new Request(`http://localhost/api/images/${encodeURIComponent(name)}/confirm`, {
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
  mocks.confirmImageUploadForUser.mockResolvedValue({
    ok: true,
    name: "diagram",
    mimeType: "image/png",
    byteSize: 1234,
    credit: null,
  });
});

describe("POST /api/images/<name>/confirm auth", () => {
  it("401s without a token, with WWW-Authenticate", async () => {
    const res = await postRequest("diagram", { blobPath: "abc.png", mime: "image/png" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(mocks.confirmImageUploadForUser).not.toHaveBeenCalled();
  });

  it("403s a valid non-teacher token", async () => {
    const res = await postRequest(
      "diagram",
      { blobPath: "abc.png", mime: "image/png" },
      await mint(false),
    );
    expect(res.status).toBe(403);
    expect(mocks.confirmImageUploadForUser).not.toHaveBeenCalled();
  });
});

describe("POST /api/images/<name>/confirm body validation", () => {
  it("400s a non-JSON body", async () => {
    const res = await postRequest("diagram", "not json", await mint());
    expect(res.status).toBe(400);
    expect(mocks.confirmImageUploadForUser).not.toHaveBeenCalled();
  });

  it("400s a missing/non-string blobPath", async () => {
    const res = await postRequest("diagram", { mime: "image/png" }, await mint());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: "blobPath must be the string the upload request returned.",
    });
    expect(mocks.confirmImageUploadForUser).not.toHaveBeenCalled();
  });

  it("400s a missing/non-string mime", async () => {
    const res = await postRequest("diagram", { blobPath: "abc.png", mime: 7 }, await mint());
    expect(res.status).toBe(400);
    expect(mocks.confirmImageUploadForUser).not.toHaveBeenCalled();
  });

  it("400s a non-string credit", async () => {
    const res = await postRequest(
      "diagram",
      { blobPath: "abc.png", mime: "image/png", credit: 42 },
      await mint(),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "credit must be a string when given." });
    expect(mocks.confirmImageUploadForUser).not.toHaveBeenCalled();
  });
});

describe("POST /api/images/<name>/confirm", () => {
  it("confirms as the verified bearer user and returns 201 with the row summary", async () => {
    const res = await postRequest(
      "diagram",
      { blobPath: "abc.png", mime: "image/png", credit: "CC BY 4.0" },
      await mint(),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    // The verified oid from the token — never anything client-supplied.
    expect(mocks.confirmImageUploadForUser).toHaveBeenCalledWith("teacher-oid-1", {
      name: "diagram",
      blobPath: "abc.png",
      mime: "image/png",
      credit: "CC BY 4.0",
    });
    expect(await res.json()).toEqual({
      name: "diagram",
      mimeType: "image/png",
      byteSize: 1234,
      credit: null,
    });
  });

  it("omits credit from the service input when not given", async () => {
    await postRequest("diagram", { blobPath: "abc.png", mime: "image/png" }, await mint());
    expect(mocks.confirmImageUploadForUser).toHaveBeenCalledWith("teacher-oid-1", {
      name: "diagram",
      blobPath: "abc.png",
      mime: "image/png",
      credit: undefined,
    });
  });

  it("maps invalid (bad landed blob) → 400 with the service message", async () => {
    mocks.confirmImageUploadForUser.mockResolvedValue({
      ok: false,
      reason: "invalid",
      message: "The upload did not complete. Try again.",
    });
    const res = await postRequest(
      "diagram",
      { blobPath: "abc.png", mime: "image/png" },
      await mint(),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "The upload did not complete. Try again." });
  });

  it("maps conflict (name race) → 409", async () => {
    mocks.confirmImageUploadForUser.mockResolvedValue({
      ok: false,
      reason: "conflict",
      message: "An image with that name already exists. Choose another name.",
    });
    const res = await postRequest(
      "diagram",
      { blobPath: "abc.png", mime: "image/png" },
      await mint(),
    );
    expect(res.status).toBe(409);
  });

  it("maps unavailable → 503", async () => {
    mocks.confirmImageUploadForUser.mockResolvedValue({
      ok: false,
      reason: "unavailable",
      message: "The upload could not be verified. Try again.",
    });
    const res = await postRequest(
      "diagram",
      { blobPath: "abc.png", mime: "image/png" },
      await mint(),
    );
    expect(res.status).toBe(503);
  });
});
