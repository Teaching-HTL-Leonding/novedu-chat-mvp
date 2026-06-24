// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The image actions are a thin auth + policy shell around the blob seam and the
// image store. These tests pin the wiring: the teacher gate, the name/MIME/size
// validation BEFORE any blob/store work, the confirm-time re-derivation of the
// landed blob's size/MIME (never trusted from the client) with a best-effort
// delete of a present-but-bad blob, and the store-reason → message mapping. The
// blob seam and the store are mocked; the pure name/MIME helpers stay real.

const mocks = vi.hoisted(() => ({
  requireTeacherUserId: vi.fn(),
  mintWriteSas: vi.fn(),
  getBlobProperties: vi.fn(),
  deleteBlob: vi.fn(),
  getActiveImage: vi.fn(),
  confirmImage: vi.fn(),
  softDeleteImage: vi.fn(),
  softDeleteImages: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/student-mode", () => ({ requireTeacherUserId: mocks.requireTeacherUserId }));
vi.mock("@/lib/image-blob", () => ({
  mintWriteSas: mocks.mintWriteSas,
  getBlobProperties: mocks.getBlobProperties,
  deleteBlob: mocks.deleteBlob,
}));
vi.mock("@/lib/image-store", () => ({
  getActiveImage: mocks.getActiveImage,
  confirmImage: mocks.confirmImage,
  softDeleteImage: mocks.softDeleteImage,
  softDeleteImages: mocks.softDeleteImages,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  confirmImageUpload,
  deleteImageAction,
  deleteSelectedImagesAction,
  requestImageUpload,
} from "@/lib/images-actions";

// 5 MB ceiling the actions enforce (matches MAX_IMAGE_BYTES in the SUT).
const MAX_BYTES = 5 * 1024 * 1024;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireTeacherUserId.mockResolvedValue({ ok: true, userId: "teacher-1" });
  mocks.mintWriteSas.mockResolvedValue("https://blob.example/abc.png?sas=write");
  mocks.getBlobProperties.mockResolvedValue({
    exists: true,
    contentType: "image/png",
    contentLength: 1234,
  });
  mocks.deleteBlob.mockResolvedValue(undefined);
  mocks.getActiveImage.mockResolvedValue(null); // name free by default
  mocks.confirmImage.mockResolvedValue({ ok: true, name: "diagram" });
  mocks.softDeleteImage.mockResolvedValue({ ok: true });
  mocks.softDeleteImages.mockResolvedValue({ ok: true, deleted: 2 });
});

describe("requestImageUpload", () => {
  it("rejects a non-teacher before any validation or minting", async () => {
    mocks.requireTeacherUserId.mockResolvedValue({ ok: false, reason: "not-teacher" });
    const result = await requestImageUpload("diagram", "image/png", 100);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/teachers/i) });
    expect(mocks.getActiveImage).not.toHaveBeenCalled();
    expect(mocks.mintWriteSas).not.toHaveBeenCalled();
  });

  it("reports a missing session user id", async () => {
    mocks.requireTeacherUserId.mockResolvedValue({ ok: false, reason: "no-user-id" });
    const result = await requestImageUpload("diagram", "image/png", 100);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/sign in/i) });
    expect(mocks.mintWriteSas).not.toHaveBeenCalled();
  });

  it("rejects a malformed name without checking the store or minting", async () => {
    const result = await requestImageUpload("bad name!", "image/png", 100);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/letters/i) });
    expect(mocks.getActiveImage).not.toHaveBeenCalled();
    expect(mocks.mintWriteSas).not.toHaveBeenCalled();
  });

  it("rejects an unsupported MIME type", async () => {
    const result = await requestImageUpload("diagram", "image/gif", 100);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/PNG, JPEG and SVG/i) });
    expect(mocks.mintWriteSas).not.toHaveBeenCalled();
  });

  it("rejects an empty (non-positive) size", async () => {
    const result = await requestImageUpload("diagram", "image/png", 0);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/empty/i) });
    expect(mocks.mintWriteSas).not.toHaveBeenCalled();
  });

  it("rejects a non-finite size", async () => {
    const result = await requestImageUpload("diagram", "image/png", Number.NaN);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/empty/i) });
    expect(mocks.mintWriteSas).not.toHaveBeenCalled();
  });

  it("rejects a size over the 5 MB ceiling", async () => {
    const result = await requestImageUpload("diagram", "image/png", MAX_BYTES + 1);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/too large|5 MB/i) });
    expect(mocks.mintWriteSas).not.toHaveBeenCalled();
  });

  it("rejects a name already in use by an active image", async () => {
    mocks.getActiveImage.mockResolvedValue({ name: "diagram", blobPath: "x.png" });
    const result = await requestImageUpload("diagram", "image/png", 100);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/already exists/i) });
    expect(mocks.mintWriteSas).not.toHaveBeenCalled();
  });

  it("reports a transient name-check failure (store undefined)", async () => {
    mocks.getActiveImage.mockResolvedValue(undefined);
    const result = await requestImageUpload("diagram", "image/png", 100);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/try again/i) });
    expect(mocks.mintWriteSas).not.toHaveBeenCalled();
  });

  it("mints a create-only SAS over a UUID blob path with the MIME's extension", async () => {
    const result = await requestImageUpload("diagram", "image/jpeg", 100);
    expect(result).toMatchObject({ ok: true, uploadUrl: "https://blob.example/abc.png?sas=write" });
    if (!result.ok) return;
    // The blob path never leaks the chosen name: a random UUID + the MIME extension.
    expect(result.blobPath).toMatch(/^[0-9a-f-]{36}\.jpg$/i);
    expect(result.blobPath).not.toContain("diagram");
    expect(mocks.mintWriteSas).toHaveBeenCalledWith(result.blobPath, "image/jpeg");
  });

  it("maps a SAS-minting failure to a retry message", async () => {
    mocks.mintWriteSas.mockRejectedValue(new Error("delegation key down"));
    const result = await requestImageUpload("diagram", "image/png", 100);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/try again/i) });
  });
});

describe("confirmImageUpload", () => {
  it("rejects a non-teacher before inspecting the blob or storing", async () => {
    mocks.requireTeacherUserId.mockResolvedValue({ ok: false, reason: "not-teacher" });
    const result = await confirmImageUpload("diagram", "abc.png", "image/png");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/teachers/i) });
    expect(mocks.getBlobProperties).not.toHaveBeenCalled();
    expect(mocks.confirmImage).not.toHaveBeenCalled();
  });

  it("rejects a malformed name without inspecting the blob", async () => {
    const result = await confirmImageUpload("bad name!", "abc.png", "image/png");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/letters/i) });
    expect(mocks.getBlobProperties).not.toHaveBeenCalled();
  });

  it("rejects an unsupported MIME type without inspecting the blob", async () => {
    const result = await confirmImageUpload("diagram", "abc.png", "image/gif");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/PNG, JPEG and SVG/i) });
    expect(mocks.getBlobProperties).not.toHaveBeenCalled();
  });

  it("reports a missing blob (upload never completed) without storing", async () => {
    mocks.getBlobProperties.mockResolvedValue({ exists: false });
    const result = await confirmImageUpload("diagram", "abc.png", "image/png");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/did not complete/i) });
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
    const result = await confirmImageUpload("diagram", "abc.png", "image/png");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/not a valid image/i) });
    expect(mocks.deleteBlob).toHaveBeenCalledWith("abc.png");
    expect(mocks.confirmImage).not.toHaveBeenCalled();
  });

  it("rejects and DELETES a blob that is over the 5 MB ceiling", async () => {
    mocks.getBlobProperties.mockResolvedValue({
      exists: true,
      contentType: "image/png",
      contentLength: MAX_BYTES + 1,
    });
    const result = await confirmImageUpload("diagram", "abc.png", "image/png");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/not a valid image/i) });
    expect(mocks.deleteBlob).toHaveBeenCalledWith("abc.png");
    expect(mocks.confirmImage).not.toHaveBeenCalled();
  });

  it("rejects and DELETES an empty (zero-byte) blob", async () => {
    mocks.getBlobProperties.mockResolvedValue({
      exists: true,
      contentType: "image/png",
      contentLength: 0,
    });
    const result = await confirmImageUpload("diagram", "abc.png", "image/png");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/not a valid image/i) });
    expect(mocks.deleteBlob).toHaveBeenCalledWith("abc.png");
    expect(mocks.confirmImage).not.toHaveBeenCalled();
  });

  it("reports a blob-inspection failure without storing", async () => {
    mocks.getBlobProperties.mockRejectedValue(new Error("storage down"));
    const result = await confirmImageUpload("diagram", "abc.png", "image/png");
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/could not be verified/i),
    });
    expect(mocks.confirmImage).not.toHaveBeenCalled();
  });

  it("stores the row with the blob-DERIVED size and revalidates on a good blob", async () => {
    const result = await confirmImageUpload("diagram", "abc.png", "image/png");
    expect(result).toEqual({ ok: true, name: "diagram" });
    // The size is re-derived from the landed blob (contentLength), never trusted;
    // with no Content Credentials given, the stored credit is null.
    expect(mocks.confirmImage).toHaveBeenCalledWith(
      { name: "diagram", blobPath: "abc.png", mimeType: "image/png", byteSize: 1234, credit: null },
      "teacher-1",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/images");
  });

  it("trims and stores an optional Content Credentials string", async () => {
    const result = await confirmImageUpload("diagram", "abc.png", "image/png", "  CC BY 4.0  ");
    expect(result).toEqual({ ok: true, name: "diagram" });
    expect(mocks.confirmImage).toHaveBeenCalledWith(
      {
        name: "diagram",
        blobPath: "abc.png",
        mimeType: "image/png",
        byteSize: 1234,
        credit: "CC BY 4.0",
      },
      "teacher-1",
    );
  });

  it("stores a whitespace-only credit as null (treated as absent)", async () => {
    await confirmImageUpload("diagram", "abc.png", "image/png", "   ");
    expect(mocks.confirmImage).toHaveBeenCalledWith(
      expect.objectContaining({ credit: null }),
      "teacher-1",
    );
  });

  it("maps a name-taken store result to a clear message", async () => {
    mocks.confirmImage.mockResolvedValue({ ok: false, reason: "name-taken" });
    const result = await confirmImageUpload("diagram", "abc.png", "image/png");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/already exists/i) });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps a store error to a retry message", async () => {
    mocks.confirmImage.mockResolvedValue({ ok: false, reason: "error" });
    const result = await confirmImageUpload("diagram", "abc.png", "image/png");
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/could not be stored/i),
    });
  });
});

describe("deleteImageAction", () => {
  it("rejects a non-teacher and never touches the store", async () => {
    mocks.requireTeacherUserId.mockResolvedValue({ ok: false, reason: "not-teacher" });
    const result = await deleteImageAction("diagram");
    expect(result).toEqual({ ok: false });
    expect(mocks.softDeleteImage).not.toHaveBeenCalled();
  });

  it("treats an already-gone image as success (idempotent), still revalidating", async () => {
    mocks.softDeleteImage.mockResolvedValue({ ok: false, reason: "not-found" });
    const result = await deleteImageAction("ghost");
    expect(result).toEqual({ ok: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/images");
  });

  it("reports a hard store error and does NOT revalidate", async () => {
    mocks.softDeleteImage.mockResolvedValue({ ok: false, reason: "error" });
    const result = await deleteImageAction("diagram");
    expect(result).toEqual({ ok: false });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("succeeds and revalidates on a real delete, passing the session user id", async () => {
    const result = await deleteImageAction("diagram");
    expect(result).toEqual({ ok: true });
    expect(mocks.softDeleteImage).toHaveBeenCalledWith("diagram", "teacher-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/images");
  });
});

// The bulk delete behind the list's "Delete Selected": the SAME teacher gate as
// the single delete and the SAME store primitive (`softDeleteImages`).
describe("deleteSelectedImagesAction", () => {
  it("rejects a non-teacher and never touches the store", async () => {
    mocks.requireTeacherUserId.mockResolvedValue({ ok: false, reason: "not-teacher" });
    const result = await deleteSelectedImagesAction(["a", "b"]);
    expect(result).toEqual({ ok: false, deleted: 0 });
    expect(mocks.softDeleteImages).not.toHaveBeenCalled();
  });

  it("deletes the selection with the session user id and revalidates", async () => {
    mocks.softDeleteImages.mockResolvedValue({ ok: true, deleted: 2 });
    const result = await deleteSelectedImagesAction(["a", "b"]);
    expect(result).toEqual({ ok: true, deleted: 2 });
    expect(mocks.softDeleteImages).toHaveBeenCalledWith(["a", "b"], "teacher-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/images");
  });

  it("maps a store failure to a not-ok result and does NOT revalidate", async () => {
    mocks.softDeleteImages.mockResolvedValue({ ok: false, deleted: 0 });
    const result = await deleteSelectedImagesAction(["a", "b"]);
    expect(result).toEqual({ ok: false, deleted: 0 });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
