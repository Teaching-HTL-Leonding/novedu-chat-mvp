import { beforeEach, describe, expect, it, vi } from "vitest";

// The coding code-module (Layer 3): validateOnCreate delegates to the coding
// Layer-2 validator; it has NO `runtime` (the module is reached only through its own
// public OpenAI-compatible route, never the CopilotKit runtime); renderDetail
// dispatches to CodingDetail; and renderResult dispatches to CodingResult (the
// little-coder connection config, not a share link). The validator + both components
// are mocked as plain functions so this is hermetic.

const codingDetail = vi.hoisted(() => vi.fn());
const codingResult = vi.hoisted(() => vi.fn());
const codingValidate = vi.hoisted(() => vi.fn());

vi.mock("@/app/[code]/_coding/coding-detail", () => ({ CodingDetail: codingDetail }));
vi.mock("@/app/[code]/_coding/coding-result", () => ({ CodingResult: codingResult }));
vi.mock("@/lib/file-validators", () => ({
  fileValidators: { coding: { validate: codingValidate } },
}));

import { codingModule } from "@/lib/code-modules/coding";
import type { CodeEntry } from "@/lib/code-store";

const entry = {
  code: "a1b2c3d4e5",
  module: "coding",
  fileUrl: "https://example.com/api/files/c",
  anonymous: true,
} as unknown as CodeEntry;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("codingModule descriptor", () => {
  it("references the coding file kind and has NO runtime", () => {
    expect(codingModule.fileKind).toBe("coding");
    expect(codingModule.runtime).toBeUndefined();
  });
});

describe("codingModule.validateOnCreate", () => {
  it("delegates to the coding Layer-2 validator", async () => {
    codingValidate.mockResolvedValue({
      ok: true,
      warnings: [],
      title: null,
      description: null,
      anonymous: true,
    });
    const fetcher = vi.fn();
    await codingModule.validateOnCreate(entry.fileUrl, fetcher);
    expect(codingValidate).toHaveBeenCalledWith(entry.fileUrl, fetcher);
  });
});

describe("codingModule.renderDetail", () => {
  it("renders CodingDetail for the entry", () => {
    codingDetail.mockReturnValue("<coding-detail/>");
    const out = codingModule.renderDetail(entry, {});
    expect(codingDetail).toHaveBeenCalledWith({ entry });
    expect(out).toBe("<coding-detail/>");
  });
});

describe("codingModule.renderResult", () => {
  it("renders CodingResult (little-coder config) with the entry + origin, not a share link", () => {
    codingResult.mockReturnValue("<coding-result/>");
    const out = codingModule.renderResult(entry, {
      shareUrl: "https://x/abc",
      origin: "https://x",
    });
    expect(codingResult).toHaveBeenCalledWith({ entry, origin: "https://x" });
    expect(out).toBe("<coding-result/>");
  });
});
