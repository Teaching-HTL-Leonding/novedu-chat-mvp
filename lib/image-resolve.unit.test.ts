// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// `resolveImageRef` turns a module's embedded `ImageRef` into a usable
// `ResolvedImage`. Three branches plus the lenient null path are pinned here over
// the one mocked I/O seam (the image store); the pure `resolveRelativeUrl` and
// `imageContentPath` it delegates to stay REAL, so the hosted branch pins the
// actual byte URL and the relative branch the actual resolution.

const mocks = vi.hoisted(() => ({
  getActiveImage: vi.fn(),
}));

vi.mock("@/lib/image-store", () => ({ getActiveImage: mocks.getActiveImage }));

import { resolveImageRef } from "@/lib/image-resolve";

const BASE = "https://example.com/dir/quiz.yaml";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActiveImage.mockResolvedValue({
    id: "11111111-2222-3333-4444-555555555555",
    name: "diagram",
    blobPath: "abc.png",
    mimeType: "image/png",
    byteSize: 10,
    validFrom: new Date(),
    createdBy: "teacher-1",
  });
});

describe("resolveImageRef — hosted branch", () => {
  it("reads the active row and points at the app's own byte route, by ROW ID", async () => {
    const result = await resolveImageRef({ hosted: true, src: "diagram", alt: "A diagram" }, BASE);
    // Root-relative: a same-origin <img> sends the session cookie the route wants.
    expect(result).toEqual({
      url: "/api/image-content/11111111-2222-3333-4444-555555555555",
      alt: "A diagram",
    });
    expect(mocks.getActiveImage).toHaveBeenCalledWith("diagram");
  });

  it("returns null for an unknown / soft-deleted hosted name", async () => {
    mocks.getActiveImage.mockResolvedValue(null);
    await expect(resolveImageRef({ hosted: true, src: "ghost" }, BASE)).resolves.toBeNull();
  });

  it("returns null when the store read fails transiently (undefined)", async () => {
    mocks.getActiveImage.mockResolvedValue(undefined);
    await expect(resolveImageRef({ hosted: true, src: "diagram" }, BASE)).resolves.toBeNull();
  });

  it("never depends on storage — the URL is built from metadata alone", async () => {
    // The base URL plays no part in the hosted branch.
    const result = await resolveImageRef({ hosted: true, src: "diagram" }, "");
    expect(result).toMatchObject({
      url: "/api/image-content/11111111-2222-3333-4444-555555555555",
    });
  });
});

describe("resolveImageRef — absolute branch", () => {
  it("uses an absolute http(s) src as-is, never touching the store", async () => {
    const result = await resolveImageRef({ src: "https://cdn.example/x.png", alt: "X" }, BASE);
    expect(result).toEqual({ url: "https://cdn.example/x.png", alt: "X" });
    expect(mocks.getActiveImage).not.toHaveBeenCalled();
  });
});

describe("resolveImageRef — relative branch", () => {
  it("resolves a relative src against the base URL", async () => {
    const result = await resolveImageRef({ src: "pic.png", alt: "P" }, BASE);
    expect(result).toEqual({ url: "https://example.com/dir/pic.png", alt: "P" });
    expect(mocks.getActiveImage).not.toHaveBeenCalled();
  });

  it("treats hosted:false the same as an unset flag (relative resolution)", async () => {
    const result = await resolveImageRef({ hosted: false, src: "pic.png" }, BASE);
    expect(result).toMatchObject({ url: "https://example.com/dir/pic.png" });
    expect(mocks.getActiveImage).not.toHaveBeenCalled();
  });
});

describe("resolveImageRef — missing ref", () => {
  it("returns null for a null ref", async () => {
    expect(await resolveImageRef(null, BASE)).toBeNull();
  });

  it("returns null for an undefined ref", async () => {
    expect(await resolveImageRef(undefined, BASE)).toBeNull();
  });

  it("returns null for a ref with an empty src", async () => {
    expect(await resolveImageRef({ src: "" }, BASE)).toBeNull();
    expect(mocks.getActiveImage).not.toHaveBeenCalled();
  });
});

describe("resolveImageRef — credit (Content Credentials)", () => {
  it("carries the hosted image's stored credit into the resolved image", async () => {
    mocks.getActiveImage.mockResolvedValue({
      id: "11111111-2222-3333-4444-555555555555",
      name: "diagram",
      blobPath: "abc.png",
      mimeType: "image/png",
      byteSize: 10,
      credit: "CC BY 4.0",
      validFrom: new Date(),
      createdBy: "teacher-1",
    });
    const result = await resolveImageRef({ hosted: true, src: "diagram" }, BASE);
    expect(result).toMatchObject({ credit: "CC BY 4.0" });
  });

  it("lets a per-ref credit override the hosted image's stored credit", async () => {
    mocks.getActiveImage.mockResolvedValue({
      id: "11111111-2222-3333-4444-555555555555",
      name: "diagram",
      blobPath: "abc.png",
      mimeType: "image/png",
      byteSize: 10,
      credit: "stored credit",
      validFrom: new Date(),
      createdBy: "teacher-1",
    });
    const result = await resolveImageRef(
      { hosted: true, src: "diagram", credit: "ref credit" },
      BASE,
    );
    expect(result).toMatchObject({ credit: "ref credit" });
  });

  it("passes a credit through for an absolute URL ref (no store touch)", async () => {
    const result = await resolveImageRef(
      { src: "https://cdn.example/x.png", credit: "Author X" },
      BASE,
    );
    expect(result).toEqual({ url: "https://cdn.example/x.png", credit: "Author X" });
    expect(mocks.getActiveImage).not.toHaveBeenCalled();
  });

  it("passes a credit through for a relative ref", async () => {
    const result = await resolveImageRef({ src: "pic.png", credit: "Author Y" }, BASE);
    expect(result).toEqual({ url: "https://example.com/dir/pic.png", credit: "Author Y" });
  });
});
