// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// `resolveImageRef` turns a module's embedded `ImageRef` into a usable
// `ResolvedImage`. Three branches plus the lenient null path are pinned here over
// mocked I/O seams (the blob SAS minter and the image store); the pure
// `resolveRelativeUrl` it delegates to stays REAL so the relative branch
// exercises the actual resolution.

const mocks = vi.hoisted(() => ({
  mintReadSas: vi.fn(),
  getActiveImage: vi.fn(),
}));

vi.mock("@/lib/image-blob", () => ({ mintReadSas: mocks.mintReadSas }));
vi.mock("@/lib/image-store", () => ({ getActiveImage: mocks.getActiveImage }));

import { resolveImageRef } from "@/lib/image-resolve";

const BASE = "https://example.com/dir/quiz.yaml";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mintReadSas.mockResolvedValue("https://blob.example/p.png?sas=read");
  mocks.getActiveImage.mockResolvedValue({
    id: "1",
    name: "diagram",
    blobPath: "abc.png",
    mimeType: "image/png",
    byteSize: 10,
    validFrom: new Date(),
    createdBy: "teacher-1",
  });
});

describe("resolveImageRef — hosted branch", () => {
  it("reads the active row and mints a read SAS over its blob path", async () => {
    const result = await resolveImageRef({ hosted: true, src: "diagram", alt: "A diagram" }, BASE);
    expect(result).toEqual({ url: "https://blob.example/p.png?sas=read", alt: "A diagram" });
    expect(mocks.getActiveImage).toHaveBeenCalledWith("diagram");
    expect(mocks.mintReadSas).toHaveBeenCalledWith("abc.png");
  });

  it("returns null for an unknown / soft-deleted hosted name without minting", async () => {
    mocks.getActiveImage.mockResolvedValue(null);
    const result = await resolveImageRef({ hosted: true, src: "ghost" }, BASE);
    expect(result).toBeNull();
    expect(mocks.mintReadSas).not.toHaveBeenCalled();
  });

  it("returns null when the store read fails transiently (undefined)", async () => {
    mocks.getActiveImage.mockResolvedValue(undefined);
    const result = await resolveImageRef({ hosted: true, src: "diagram" }, BASE);
    expect(result).toBeNull();
    expect(mocks.mintReadSas).not.toHaveBeenCalled();
  });

  it("stays lenient (null) when the SAS mint throws, rather than propagating", async () => {
    mocks.mintReadSas.mockRejectedValue(new Error("credential unavailable"));
    const result = await resolveImageRef({ hosted: true, src: "diagram", alt: "A diagram" }, BASE);
    expect(result).toBeNull();
    expect(mocks.mintReadSas).toHaveBeenCalledWith("abc.png");
  });
});

describe("resolveImageRef — absolute branch", () => {
  it("uses an absolute http(s) src as-is, never touching the store or SAS", async () => {
    const result = await resolveImageRef({ src: "https://cdn.example/x.png", alt: "X" }, BASE);
    expect(result).toEqual({ url: "https://cdn.example/x.png", alt: "X" });
    expect(mocks.getActiveImage).not.toHaveBeenCalled();
    expect(mocks.mintReadSas).not.toHaveBeenCalled();
  });
});

describe("resolveImageRef — relative branch", () => {
  it("resolves a relative src against the base URL", async () => {
    const result = await resolveImageRef({ src: "pic.png", alt: "P" }, BASE);
    expect(result).toEqual({ url: "https://example.com/dir/pic.png", alt: "P" });
    expect(mocks.getActiveImage).not.toHaveBeenCalled();
    expect(mocks.mintReadSas).not.toHaveBeenCalled();
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
      id: "1",
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
      id: "1",
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
