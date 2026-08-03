// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The image service is the auth-free policy pipeline shared by the web actions
// and the bearer API routes. These tests pin the reason discriminants the
// channels map to HTTP statuses (invalid → 400, conflict → 409, unavailable →
// 503), the name/MIME/size validation BEFORE any blob/store work, the UUID blob
// path, the confirm-time re-derivation of the landed blob's size/MIME with a
// best-effort delete of a present-but-bad blob, and the credit normalization.
// The blob seam and the store are mocked; the pure name/MIME helpers stay real.

const mocks = vi.hoisted(() => ({
  mintWriteSas: vi.fn(),
  getBlobProperties: vi.fn(),
  deleteBlob: vi.fn(),
  getActiveImage: vi.fn(),
  confirmImage: vi.fn(),
}));

vi.mock("@/lib/image-blob", () => ({
  mintWriteSas: mocks.mintWriteSas,
  getBlobProperties: mocks.getBlobProperties,
  deleteBlob: mocks.deleteBlob,
}));
vi.mock("@/lib/image-store", () => ({
  getActiveImage: mocks.getActiveImage,
  confirmImage: mocks.confirmImage,
}));

import {
  confirmImageUploadForUser,
  MAX_IMAGE_BYTES,
  prepareImageUpload,
} from "@/lib/image-service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mintWriteSas.mockResolvedValue("https://blob.example/abc.png?sas=write");
  mocks.getBlobProperties.mockResolvedValue({
    exists: true,
    contentType: "image/png",
    contentLength: 1234,
  });
  mocks.deleteBlob.mockResolvedValue(undefined);
  mocks.getActiveImage.mockResolvedValue(null); // name free by default
  mocks.confirmImage.mockResolvedValue({ ok: true, name: "diagram" });
});

describe("prepareImageUpload", () => {
  it("rejects a malformed name as invalid without checking the store or minting", async () => {
    const result = await prepareImageUpload({
      name: "bad name!",
      mime: "image/png",
      byteSize: 100,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      message: expect.stringMatching(/letters/i),
    });
    expect(mocks.getActiveImage).not.toHaveBeenCalled();
    expect(mocks.mintWriteSas).not.toHaveBeenCalled();
  });

  it("rejects an unsupported MIME type as invalid", async () => {
    const result = await prepareImageUpload({ name: "diagram", mime: "image/gif", byteSize: 100 });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      message: expect.stringMatching(/PNG, JPEG and SVG/i),
    });
    expect(mocks.mintWriteSas).not.toHaveBeenCalled();
  });

  it("rejects an empty (non-positive) size as invalid", async () => {
    const result = await prepareImageUpload({ name: "diagram", mime: "image/png", byteSize: 0 });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      message: expect.stringMatching(/empty/i),
    });
    expect(mocks.mintWriteSas).not.toHaveBeenCalled();
  });

  it("rejects a non-finite size as invalid", async () => {
    const result = await prepareImageUpload({
      name: "diagram",
      mime: "image/png",
      byteSize: Number.NaN,
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(mocks.mintWriteSas).not.toHaveBeenCalled();
  });

  it("rejects a size over the 5 MB ceiling as invalid", async () => {
    const result = await prepareImageUpload({
      name: "diagram",
      mime: "image/png",
      byteSize: MAX_IMAGE_BYTES + 1,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      message: expect.stringMatching(/too large|5 MB/i),
    });
    expect(mocks.mintWriteSas).not.toHaveBeenCalled();
  });

  it("rejects a name already in use as a conflict", async () => {
    mocks.getActiveImage.mockResolvedValue({ name: "diagram", blobPath: "x.png" });
    const result = await prepareImageUpload({ name: "diagram", mime: "image/png", byteSize: 100 });
    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      message: expect.stringMatching(/already exists/i),
    });
    expect(mocks.mintWriteSas).not.toHaveBeenCalled();
  });

  it("reports a transient name-check failure (store undefined) as unavailable", async () => {
    mocks.getActiveImage.mockResolvedValue(undefined);
    const result = await prepareImageUpload({ name: "diagram", mime: "image/png", byteSize: 100 });
    expect(result).toMatchObject({
      ok: false,
      reason: "unavailable",
      message: expect.stringMatching(/try again/i),
    });
    expect(mocks.mintWriteSas).not.toHaveBeenCalled();
  });

  it("mints a create-only SAS over a UUID blob path with the MIME's extension", async () => {
    const result = await prepareImageUpload({ name: "diagram", mime: "image/jpeg", byteSize: 100 });
    expect(result).toMatchObject({ ok: true, uploadUrl: "https://blob.example/abc.png?sas=write" });
    if (!result.ok) return;
    // The blob path never leaks the chosen name: a random UUID + the MIME extension.
    expect(result.blobPath).toMatch(/^[0-9a-f-]{36}\.jpg$/i);
    expect(result.blobPath).not.toContain("diagram");
    expect(mocks.mintWriteSas).toHaveBeenCalledWith(result.blobPath, "image/jpeg");
  });

  it("trims the name before checking and minting", async () => {
    const result = await prepareImageUpload({
      name: "  diagram  ",
      mime: "image/png",
      byteSize: 100,
    });
    expect(result).toMatchObject({ ok: true });
    expect(mocks.getActiveImage).toHaveBeenCalledWith("diagram");
  });

  it("maps a SAS-minting failure to unavailable", async () => {
    mocks.mintWriteSas.mockRejectedValue(new Error("delegation key down"));
    const result = await prepareImageUpload({ name: "diagram", mime: "image/png", byteSize: 100 });
    expect(result).toMatchObject({
      ok: false,
      reason: "unavailable",
      message: expect.stringMatching(/try again/i),
    });
  });
});

describe("confirmImageUploadForUser", () => {
  it("rejects a malformed name as invalid without inspecting the blob", async () => {
    const result = await confirmImageUploadForUser("teacher-1", {
      name: "bad name!",
      blobPath: "abc.png",
      mime: "image/png",
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(mocks.getBlobProperties).not.toHaveBeenCalled();
  });

  it("rejects an unsupported MIME type as invalid without inspecting the blob", async () => {
    const result = await confirmImageUploadForUser("teacher-1", {
      name: "diagram",
      blobPath: "abc.png",
      mime: "image/gif",
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(mocks.getBlobProperties).not.toHaveBeenCalled();
  });

  it("reports a missing blob (upload never completed) as invalid without storing", async () => {
    mocks.getBlobProperties.mockResolvedValue({ exists: false });
    const result = await confirmImageUploadForUser("teacher-1", {
      name: "diagram",
      blobPath: "abc.png",
      mime: "image/png",
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      message: expect.stringMatching(/did not complete/i),
    });
    expect(mocks.confirmImage).not.toHaveBeenCalled();
    // Nothing landed, so there is nothing to clean up.
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
  });

  it("rejects and DELETES a blob whose content type does not match the claimed MIME", async () => {
    mocks.getBlobProperties.mockResolvedValue({
      exists: true,
      contentType: "image/jpeg",
      contentLength: 1234,
    });
    const result = await confirmImageUploadForUser("teacher-1", {
      name: "diagram",
      blobPath: "abc.png",
      mime: "image/png",
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid",
      message: expect.stringMatching(/not a valid image/i),
    });
    expect(mocks.deleteBlob).toHaveBeenCalledWith("abc.png");
    expect(mocks.confirmImage).not.toHaveBeenCalled();
  });

  it("rejects and DELETES a blob that is over the 5 MB ceiling", async () => {
    mocks.getBlobProperties.mockResolvedValue({
      exists: true,
      contentType: "image/png",
      contentLength: MAX_IMAGE_BYTES + 1,
    });
    const result = await confirmImageUploadForUser("teacher-1", {
      name: "diagram",
      blobPath: "abc.png",
      mime: "image/png",
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(mocks.deleteBlob).toHaveBeenCalledWith("abc.png");
    expect(mocks.confirmImage).not.toHaveBeenCalled();
  });

  it("still rejects (invalid) when the bad blob's cleanup delete fails", async () => {
    mocks.getBlobProperties.mockResolvedValue({
      exists: true,
      contentType: "image/png",
      contentLength: 0,
    });
    mocks.deleteBlob.mockRejectedValue(new Error("storage down"));
    const result = await confirmImageUploadForUser("teacher-1", {
      name: "diagram",
      blobPath: "abc.png",
      mime: "image/png",
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(mocks.confirmImage).not.toHaveBeenCalled();
  });

  it("reports a blob-inspection failure as unavailable without storing", async () => {
    mocks.getBlobProperties.mockRejectedValue(new Error("storage down"));
    const result = await confirmImageUploadForUser("teacher-1", {
      name: "diagram",
      blobPath: "abc.png",
      mime: "image/png",
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "unavailable",
      message: expect.stringMatching(/could not be verified/i),
    });
    expect(mocks.confirmImage).not.toHaveBeenCalled();
  });

  it("stores the row as the given user with the blob-DERIVED size and echoes the summary", async () => {
    const result = await confirmImageUploadForUser("teacher-1", {
      name: "diagram",
      blobPath: "abc.png",
      mime: "image/png",
    });
    // The size is re-derived from the landed blob (contentLength), never trusted;
    // with no Content Credentials given, the stored credit is null.
    expect(result).toEqual({
      ok: true,
      name: "diagram",
      mimeType: "image/png",
      byteSize: 1234,
      credit: null,
    });
    expect(mocks.confirmImage).toHaveBeenCalledWith(
      { name: "diagram", blobPath: "abc.png", mimeType: "image/png", byteSize: 1234, credit: null },
      "teacher-1",
    );
  });

  it("trims and stores an optional Content Credentials string", async () => {
    const result = await confirmImageUploadForUser("teacher-1", {
      name: "diagram",
      blobPath: "abc.png",
      mime: "image/png",
      credit: "  CC BY 4.0  ",
    });
    expect(result).toMatchObject({ ok: true, credit: "CC BY 4.0" });
    expect(mocks.confirmImage).toHaveBeenCalledWith(
      expect.objectContaining({ credit: "CC BY 4.0" }),
      "teacher-1",
    );
  });

  it("clamps an overlong credit to the 512-char column width", async () => {
    await confirmImageUploadForUser("teacher-1", {
      name: "diagram",
      blobPath: "abc.png",
      mime: "image/png",
      credit: "x".repeat(600),
    });
    expect(mocks.confirmImage).toHaveBeenCalledWith(
      expect.objectContaining({ credit: "x".repeat(512) }),
      "teacher-1",
    );
  });

  it("stores a whitespace-only credit as null (treated as absent)", async () => {
    await confirmImageUploadForUser("teacher-1", {
      name: "diagram",
      blobPath: "abc.png",
      mime: "image/png",
      credit: "   ",
    });
    expect(mocks.confirmImage).toHaveBeenCalledWith(
      expect.objectContaining({ credit: null }),
      "teacher-1",
    );
  });

  it("maps a name-taken store result to a conflict", async () => {
    mocks.confirmImage.mockResolvedValue({ ok: false, reason: "name-taken" });
    const result = await confirmImageUploadForUser("teacher-1", {
      name: "diagram",
      blobPath: "abc.png",
      mime: "image/png",
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      message: expect.stringMatching(/already exists/i),
    });
  });

  it("maps a store error to unavailable", async () => {
    mocks.confirmImage.mockResolvedValue({ ok: false, reason: "error" });
    const result = await confirmImageUploadForUser("teacher-1", {
      name: "diagram",
      blobPath: "abc.png",
      mime: "image/png",
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "unavailable",
      message: expect.stringMatching(/could not be stored/i),
    });
  });
});
