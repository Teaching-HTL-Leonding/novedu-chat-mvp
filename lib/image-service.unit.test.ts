// @vitest-environment node
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The image service is the auth-free policy pipeline shared by the web action
// and the bearer API route. These tests pin the reason discriminants the
// channels map to HTTP statuses (invalid → 400, conflict → 409, unavailable →
// 503), the name/MIME/size checks BEFORE a single byte is written, the
// server-generated object key, the MEASURED byte length being what gets stored,
// and — the consistency rule — that a DEFINITE insert failure removes the object
// while an UNCERTAIN one leaves it for reconciliation. The filesystem adapter,
// the store and telemetry are mocked; the pure name/MIME helpers stay real.

const mocks = vi.hoisted(() => ({
  writeNewObject: vi.fn(),
  deleteObject: vi.fn(),
  getActiveImage: vi.fn(),
  createImage: vi.fn(),
  recordError: vi.fn(),
}));

vi.mock("@/lib/image-fs", () => ({
  writeNewObject: mocks.writeNewObject,
  deleteObject: mocks.deleteObject,
}));
vi.mock("@/lib/image-store", () => ({
  getActiveImage: mocks.getActiveImage,
  createImage: mocks.createImage,
}));
vi.mock("@/lib/telemetry", () => ({ recordError: mocks.recordError }));

import { createImageForUser, MAX_IMAGE_BYTES } from "@/lib/image-service";

/** A `File`-like source of `size` bytes — what both channels hand the service. */
function content(size: number, type = "image/png"): Blob {
  return new Blob([new Uint8Array(size)], { type });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writeNewObject.mockResolvedValue({ ok: true, byteLength: 1234 });
  mocks.deleteObject.mockResolvedValue({ ok: true, existed: true });
  mocks.getActiveImage.mockResolvedValue(null); // name free by default
  mocks.createImage.mockResolvedValue({ ok: true, id: "row-1", name: "diagram" });
});

describe("createImageForUser — request validation", () => {
  it("rejects a malformed name without checking the store or writing", async () => {
    const result = await createImageForUser("teacher-1", {
      name: "bad name!",
      mime: "image/png",
      content: content(10),
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      message: expect.stringMatching(/letters/i),
    });
    expect(mocks.getActiveImage).not.toHaveBeenCalled();
    expect(mocks.writeNewObject).not.toHaveBeenCalled();
  });

  it("rejects an unsupported MIME type", async () => {
    const result = await createImageForUser("teacher-1", {
      name: "diagram",
      mime: "image/gif",
      content: content(10, "image/gif"),
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      message: expect.stringMatching(/PNG, JPEG and SVG/i),
    });
    expect(mocks.writeNewObject).not.toHaveBeenCalled();
  });

  it("rejects an empty file BEFORE touching the adapter", async () => {
    const result = await createImageForUser("teacher-1", {
      name: "diagram",
      mime: "image/png",
      content: content(0),
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      message: expect.stringMatching(/empty/i),
    });
    expect(mocks.writeNewObject).not.toHaveBeenCalled();
  });

  it("rejects one byte over the 5 MB ceiling BEFORE touching the adapter", async () => {
    const result = await createImageForUser("teacher-1", {
      name: "diagram",
      mime: "image/png",
      content: content(MAX_IMAGE_BYTES + 1),
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      message: expect.stringMatching(/too large|5 MB/i),
    });
    expect(mocks.writeNewObject).not.toHaveBeenCalled();
  });

  it("accepts exactly 5 MB", async () => {
    mocks.writeNewObject.mockResolvedValue({ ok: true, byteLength: MAX_IMAGE_BYTES });
    const result = await createImageForUser("teacher-1", {
      name: "diagram",
      mime: "image/png",
      content: content(MAX_IMAGE_BYTES),
    });
    expect(result).toMatchObject({ ok: true, byteSize: MAX_IMAGE_BYTES });
  });

  it("rejects a name already in use as a conflict, without writing", async () => {
    mocks.getActiveImage.mockResolvedValue({ name: "diagram", blobPath: "x.png" });
    const result = await createImageForUser("teacher-1", {
      name: "diagram",
      mime: "image/png",
      content: content(10),
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      message: expect.stringMatching(/already exists/i),
    });
    expect(mocks.writeNewObject).not.toHaveBeenCalled();
  });

  it("reports a transient name-check failure (store undefined) as unavailable", async () => {
    mocks.getActiveImage.mockResolvedValue(undefined);
    const result = await createImageForUser("teacher-1", {
      name: "diagram",
      mime: "image/png",
      content: content(10),
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "unavailable",
      message: expect.stringMatching(/try again/i),
    });
    expect(mocks.writeNewObject).not.toHaveBeenCalled();
  });

  it("trims the name before checking and storing", async () => {
    await createImageForUser("teacher-1", {
      name: "  diagram  ",
      mime: "image/png",
      content: content(10),
    });
    expect(mocks.getActiveImage).toHaveBeenCalledWith("diagram");
    expect(mocks.createImage).toHaveBeenCalledWith(
      expect.objectContaining({ name: "diagram" }),
      "teacher-1",
    );
  });
});

describe("createImageForUser — writing the object", () => {
  it("writes under a server-generated UUID key that never leaks the name", async () => {
    await createImageForUser("teacher-1", {
      name: "diagram",
      mime: "image/jpeg",
      content: content(10, "image/jpeg"),
    });
    const [key, , maxBytes] = mocks.writeNewObject.mock.calls[0];
    expect(key).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(key).not.toContain("diagram");
    expect(maxBytes).toBe(MAX_IMAGE_BYTES);
    expect(mocks.createImage).toHaveBeenCalledWith(
      expect.objectContaining({ blobPath: key }),
      "teacher-1",
    );
  });

  it("stores the MEASURED byte length, not the declared file size", async () => {
    mocks.writeNewObject.mockResolvedValue({ ok: true, byteLength: 4242 });
    const result = await createImageForUser("teacher-1", {
      name: "diagram",
      mime: "image/png",
      content: content(10),
    });
    expect(result).toMatchObject({ ok: true, byteSize: 4242 });
    expect(mocks.createImage).toHaveBeenCalledWith(
      expect.objectContaining({ byteSize: 4242 }),
      "teacher-1",
    );
  });

  it("maps an adapter too-large to invalid", async () => {
    mocks.writeNewObject.mockResolvedValue({ ok: false, reason: "too-large", detail: "big" });
    const result = await createImageForUser("teacher-1", {
      name: "diagram",
      mime: "image/png",
      content: content(10),
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      message: expect.stringMatching(/too large/i),
    });
    expect(mocks.createImage).not.toHaveBeenCalled();
  });

  it("maps an adapter empty to invalid", async () => {
    mocks.writeNewObject.mockResolvedValue({ ok: false, reason: "empty", detail: "nothing" });
    const result = await createImageForUser("teacher-1", {
      name: "diagram",
      mime: "image/png",
      content: content(10),
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      message: expect.stringMatching(/empty/i),
    });
  });

  it("maps a failing source stream to invalid", async () => {
    mocks.writeNewObject.mockResolvedValue({ ok: false, reason: "source", detail: "cut short" });
    const result = await createImageForUser("teacher-1", {
      name: "diagram",
      mime: "image/png",
      content: content(10),
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      message: expect.stringMatching(/did not complete/i),
    });
  });

  it("maps an unavailable root to unavailable, without storing", async () => {
    mocks.writeNewObject.mockResolvedValue({
      ok: false,
      reason: "unavailable",
      detail: "/novedu-files does not exist.",
    });
    const result = await createImageForUser("teacher-1", {
      name: "diagram",
      mime: "image/png",
      content: content(10),
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "unavailable",
      message: expect.stringMatching(/storage is unavailable/i),
    });
    expect(mocks.createImage).not.toHaveBeenCalled();
  });

  it("retries a key collision ONCE with a fresh key", async () => {
    mocks.writeNewObject
      .mockResolvedValueOnce({ ok: false, reason: "exists", detail: "taken" })
      .mockResolvedValueOnce({ ok: true, byteLength: 99 });
    const result = await createImageForUser("teacher-1", {
      name: "diagram",
      mime: "image/png",
      content: content(10),
    });
    expect(result).toMatchObject({ ok: true, byteSize: 99 });
    expect(mocks.writeNewObject).toHaveBeenCalledTimes(2);
    const [first] = mocks.writeNewObject.mock.calls[0];
    const [second] = mocks.writeNewObject.mock.calls[1];
    expect(second).not.toBe(first);
    expect(mocks.createImage).toHaveBeenCalledWith(
      expect.objectContaining({ blobPath: second }),
      "teacher-1",
    );
  });

  it("gives up as unavailable when the retry collides too", async () => {
    mocks.writeNewObject.mockResolvedValue({ ok: false, reason: "exists", detail: "taken" });
    const result = await createImageForUser("teacher-1", {
      name: "diagram",
      mime: "image/png",
      content: content(10),
    });
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    expect(mocks.writeNewObject).toHaveBeenCalledTimes(2);
    expect(mocks.createImage).not.toHaveBeenCalled();
  });
});

describe("createImageForUser — credit normalization", () => {
  it("trims a Content Credentials string", async () => {
    const result = await createImageForUser("teacher-1", {
      name: "diagram",
      mime: "image/png",
      credit: "  CC BY 4.0  ",
      content: content(10),
    });
    expect(result).toMatchObject({ ok: true, credit: "CC BY 4.0" });
    expect(mocks.createImage).toHaveBeenCalledWith(
      expect.objectContaining({ credit: "CC BY 4.0" }),
      "teacher-1",
    );
  });

  it("stores a whitespace-only credit as null (treated as absent)", async () => {
    await createImageForUser("teacher-1", {
      name: "diagram",
      mime: "image/png",
      credit: "   ",
      content: content(10),
    });
    expect(mocks.createImage).toHaveBeenCalledWith(
      expect.objectContaining({ credit: null }),
      "teacher-1",
    );
  });

  it("clamps an overlong credit to the 512-char column width", async () => {
    await createImageForUser("teacher-1", {
      name: "diagram",
      mime: "image/png",
      credit: "x".repeat(600),
      content: content(10),
    });
    expect(mocks.createImage).toHaveBeenCalledWith(
      expect.objectContaining({ credit: "x".repeat(512) }),
      "teacher-1",
    );
  });

  it("returns the whole summary, including the new row id", async () => {
    mocks.createImage.mockResolvedValue({ ok: true, id: "row-42", name: "diagram" });
    mocks.writeNewObject.mockResolvedValue({ ok: true, byteLength: 7 });
    await expect(
      createImageForUser("teacher-1", {
        name: "diagram",
        mime: "image/svg+xml",
        content: content(10, "image/svg+xml"),
      }),
    ).resolves.toEqual({
      ok: true,
      id: "row-42",
      name: "diagram",
      mimeType: "image/svg+xml",
      byteSize: 7,
      credit: null,
    });
  });
});

describe("createImageForUser — insert outcome and cleanup", () => {
  it("removes ONLY its own object when the name was taken in a race", async () => {
    mocks.createImage.mockResolvedValue({ ok: false, reason: "name-taken" });
    const result = await createImageForUser("teacher-1", {
      name: "diagram",
      mime: "image/png",
      content: content(10),
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      message: expect.stringMatching(/already exists/i),
    });
    const [key] = mocks.writeNewObject.mock.calls[0];
    expect(mocks.deleteObject).toHaveBeenCalledTimes(1);
    expect(mocks.deleteObject).toHaveBeenCalledWith(key);
  });

  it("removes the object after a DEFINITE insert failure", async () => {
    mocks.createImage.mockResolvedValue({ ok: false, reason: "error", outcome: "definite" });
    const result = await createImageForUser("teacher-1", {
      name: "diagram",
      mime: "image/png",
      content: content(10),
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "unavailable",
      message: expect.stringMatching(/could not be stored/i),
    });
    const [key] = mocks.writeNewObject.mock.calls[0];
    expect(mocks.deleteObject).toHaveBeenCalledWith(key);
    expect(mocks.recordError).not.toHaveBeenCalled();
  });

  it("LEAVES the object and records the incident after an UNCERTAIN insert failure", async () => {
    mocks.createImage.mockResolvedValue({ ok: false, reason: "error", outcome: "uncertain" });
    const result = await createImageForUser("teacher-1", {
      name: "diagram",
      mime: "image/png",
      content: content(10),
    });
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    expect(mocks.deleteObject).not.toHaveBeenCalled();
    const [key] = mocks.writeNewObject.mock.calls[0];
    expect(mocks.recordError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ "novedu.area": "image-service", "novedu.image.key": key }),
    );
  });

  it("keeps the primary result when the cleanup delete itself fails", async () => {
    mocks.createImage.mockResolvedValue({ ok: false, reason: "error", outcome: "definite" });
    mocks.deleteObject.mockResolvedValue({ ok: false, reason: "error", detail: "io" });
    const result = await createImageForUser("teacher-1", {
      name: "diagram",
      mime: "image/png",
      content: content(10),
    });
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
  });
});

// The upload form is a CLIENT component and cannot import this server module, so
// it carries its own copy of the ceiling. The two must never drift — a form that
// admits more than the service does would fail the teacher after the upload.
describe("the client copy of MAX_IMAGE_BYTES", () => {
  it("matches the form's literal", () => {
    const source = readFileSync("app/images/new/upload-image-form.tsx", "utf8");
    expect(source).toMatch(/const MAX_IMAGE_BYTES = 5 \* 1024 \* 1024;/);
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });
});
