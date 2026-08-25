import { beforeEach, describe, expect, it, vi } from "vitest";

// The coding code-module (Layer 3): it has NO `runtime` (the module is reached only
// through its own public OpenAI-compatible route, never the CopilotKit runtime), and
// renderDetail dispatches to CodingDetail. Every module — coding included — now uses
// the registry's shared `ShareLinkResult` create/edit result, so there is no
// per-module override to test here. CodingDetail is mocked as a plain function so
// this is hermetic. Create-time validation is derived from fileKind by the registry,
// so it is not tested here.

const codingDetail = vi.hoisted(() => vi.fn());

vi.mock("@/app/[code]/_coding/coding-detail", () => ({ CodingDetail: codingDetail }));

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

describe("codingModule.renderDetail", () => {
  it("renders CodingDetail for the entry", () => {
    codingDetail.mockReturnValue("<coding-detail/>");
    const out = codingModule.renderDetail(entry, {});
    expect(codingDetail).toHaveBeenCalledWith({ entry });
    expect(out).toBe("<coding-detail/>");
  });
});
