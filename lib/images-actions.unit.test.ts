// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The image actions are a thin auth + parsing shell around the service and the
// image store. These tests pin the wiring: the effective-teacher gate BEFORE any
// parsing, the FormData field checks (a hand-crafted POST reaches a server
// action just like the form does), the local size ceiling, the exact forwarding
// to the service, the message pass-through, and `revalidatePath` only on
// success. The service and the store are mocked.

const mocks = vi.hoisted(() => ({
  requireTeacherUserId: vi.fn(),
  createImageForUser: vi.fn(),
  softDeleteImages: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/student-mode", () => ({ requireTeacherUserId: mocks.requireTeacherUserId }));
vi.mock("@/lib/image-service", () => ({
  createImageForUser: mocks.createImageForUser,
  MAX_IMAGE_BYTES: 5 * 1024 * 1024,
}));
vi.mock("@/lib/image-store", () => ({ softDeleteImages: mocks.softDeleteImages }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { deleteSelectedImagesAction, uploadImage } from "@/lib/images-actions";

// 5 MB ceiling the action enforces (matches MAX_IMAGE_BYTES in the service).
const MAX_BYTES = 5 * 1024 * 1024;

function pngFile(size = 8, name = "red.png"): File {
  return new File([new Uint8Array(size)], name, { type: "image/png" });
}

function uploadForm(
  overrides: {
    file?: File | string | null;
    extraFile?: File;
    name?: string | null;
    extraName?: string;
    mime?: string | null;
    credit?: string;
    extraCredit?: string;
  } = {},
): FormData {
  const form = new FormData();
  if (overrides.file !== null) form.append("file", overrides.file ?? pngFile());
  if (overrides.extraFile) form.append("file", overrides.extraFile);
  if (overrides.name !== null) form.append("name", overrides.name ?? "diagram");
  if (overrides.extraName) form.append("name", overrides.extraName);
  if (overrides.mime !== null) form.append("mime", overrides.mime ?? "image/png");
  if (overrides.credit !== undefined) form.append("credit", overrides.credit);
  if (overrides.extraCredit) form.append("credit", overrides.extraCredit);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireTeacherUserId.mockResolvedValue({ ok: true, userId: "teacher-1" });
  mocks.createImageForUser.mockResolvedValue({
    ok: true,
    id: "row-1",
    name: "diagram",
    mimeType: "image/png",
    byteSize: 8,
    credit: null,
  });
  mocks.softDeleteImages.mockResolvedValue({ ok: true, deleted: 2 });
});

describe("uploadImage — the gate", () => {
  it("refuses a caller the gate rejects (signed out, student, or teacher in student mode)", async () => {
    // `requireTeacherUserId` collapses all three into one `{ ok: false }`.
    mocks.requireTeacherUserId.mockResolvedValue({ ok: false });
    const result = await uploadImage(uploadForm());
    expect(result).toEqual({ ok: false, error: "Only teachers can upload images." });
    expect(mocks.createImageForUser).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("uploadImage — form parsing", () => {
  const incomplete = { ok: false, error: "The upload form was incomplete. Try again." };

  it("refuses a missing file part", async () => {
    expect(await uploadImage(uploadForm({ file: null }))).toEqual(incomplete);
    expect(mocks.createImageForUser).not.toHaveBeenCalled();
  });

  it("refuses a duplicate file part", async () => {
    expect(await uploadImage(uploadForm({ extraFile: pngFile(4, "b.png") }))).toEqual(incomplete);
    expect(mocks.createImageForUser).not.toHaveBeenCalled();
  });

  it("refuses a file sent as a plain string", async () => {
    expect(await uploadImage(uploadForm({ file: "not-a-file" }))).toEqual(incomplete);
    expect(mocks.createImageForUser).not.toHaveBeenCalled();
  });

  it("refuses a missing or duplicated name", async () => {
    expect(await uploadImage(uploadForm({ name: null }))).toEqual(incomplete);
    expect(await uploadImage(uploadForm({ extraName: "other" }))).toEqual(incomplete);
    expect(mocks.createImageForUser).not.toHaveBeenCalled();
  });

  it("refuses a missing mime", async () => {
    expect(await uploadImage(uploadForm({ mime: null }))).toEqual(incomplete);
    expect(mocks.createImageForUser).not.toHaveBeenCalled();
  });

  it("refuses a duplicated credit", async () => {
    expect(await uploadImage(uploadForm({ credit: "a", extraCredit: "b" }))).toEqual(incomplete);
    expect(mocks.createImageForUser).not.toHaveBeenCalled();
  });

  it("refuses a file over 5 MB BEFORE calling the service", async () => {
    const result = await uploadImage(uploadForm({ file: pngFile(MAX_BYTES + 1) }));
    expect(result).toEqual({ ok: false, error: "The image is too large — the maximum is 5 MB." });
    expect(mocks.createImageForUser).not.toHaveBeenCalled();
  });

  it("accepts a file of exactly 5 MB", async () => {
    const result = await uploadImage(uploadForm({ file: pngFile(MAX_BYTES) }));
    expect(result).toEqual({ ok: true, name: "diagram" });
  });
});

describe("uploadImage — forwarding and result", () => {
  it("forwards the exact name, mime, credit and file to the service and revalidates", async () => {
    const file = pngFile(8);
    const form = uploadForm({ file, credit: "CC BY 4.0" });

    const result = await uploadImage(form);

    expect(result).toEqual({ ok: true, name: "diagram" });
    expect(mocks.createImageForUser).toHaveBeenCalledWith("teacher-1", {
      name: "diagram",
      mime: "image/png",
      credit: "CC BY 4.0",
      content: file,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/images");
  });

  it("omits credit when the form carries none", async () => {
    await uploadImage(uploadForm());
    const [, input] = mocks.createImageForUser.mock.calls[0] ?? [];
    expect(input.credit).toBeUndefined();
  });

  it("passes the service's message through and does NOT revalidate", async () => {
    mocks.createImageForUser.mockResolvedValue({
      ok: false,
      reason: "conflict",
      message: "An image with that name already exists. Choose another name.",
    });
    const result = await uploadImage(uploadForm());
    expect(result).toEqual({
      ok: false,
      error: "An image with that name already exists. Choose another name.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("passes an unavailable message through unchanged", async () => {
    mocks.createImageForUser.mockResolvedValue({
      ok: false,
      reason: "unavailable",
      message: "Image storage is unavailable right now. Try again later.",
    });
    const result = await uploadImage(uploadForm());
    expect(result).toMatchObject({ ok: false, error: /storage is unavailable/ });
  });
});

// The bulk delete behind the list's "Delete Selected" — the only delete path: the
// teacher gate and the `softDeleteImages` store primitive.
describe("deleteSelectedImagesAction", () => {
  it("rejects a non-teacher and never touches the store", async () => {
    mocks.requireTeacherUserId.mockResolvedValue({ ok: false });
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
