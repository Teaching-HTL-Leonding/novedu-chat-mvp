import { beforeEach, describe, expect, it, vi } from "vitest";

// Layer-2 validator seam + the runtime-light readAnonymousFlag, both keyed by
// FileKind. The underlying loaders (lib/tutors, lib/quiz-fetch, lib/quiz-yaml) are
// mocked so this is hermetic — it asserts the MAPPING each kind performs (which
// loader, which options, how the result is shaped), not the parsing itself.

const mocks = vi.hoisted(() => ({
  loadAndBuildTutorPrompt: vi.fn(),
  loadAndCheckFragmentFile: vi.fn(),
  loadQuiz: vi.fn(),
  parseQuiz: vi.fn(),
  loadWriting: vi.fn(),
  parseWriting: vi.fn(),
}));

vi.mock("@/lib/tutors", () => ({
  defaultFetcher: {},
  loadAndBuildTutorPrompt: mocks.loadAndBuildTutorPrompt,
  loadAndCheckFragmentFile: mocks.loadAndCheckFragmentFile,
}));
vi.mock("@/lib/quiz-fetch", () => ({ loadQuiz: mocks.loadQuiz }));
vi.mock("@/lib/quiz-yaml", () => ({ parseQuiz: mocks.parseQuiz }));
vi.mock("@/lib/writing-fetch", () => ({ loadWriting: mocks.loadWriting }));
vi.mock("@/lib/writing-yaml", () => ({ parseWriting: mocks.parseWriting }));

import { fileValidators, readAnonymousFlag } from "@/lib/file-validators";

const URL_ = "https://example.com/file.yaml";
const fetcher = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fileValidators.tutor", () => {
  it("runs the THOROUGH library check and maps title/description/anonymous", async () => {
    mocks.loadAndBuildTutorPrompt.mockResolvedValue({
      ok: true,
      warnings: ["w"],
      title: "T",
      description: "D",
      anonymous: false,
    });
    const result = await fileValidators.tutor.validate(URL_, fetcher);
    expect(mocks.loadAndBuildTutorPrompt).toHaveBeenCalledWith(URL_, fetcher, {
      validateLibraries: true,
    });
    expect(result).toEqual({
      ok: true,
      warnings: ["w"],
      title: "T",
      description: "D",
      anonymous: false,
    });
  });

  it("defaults title/description to null and anonymous to true when the build omits them", async () => {
    mocks.loadAndBuildTutorPrompt.mockResolvedValue({ ok: true, warnings: [] });
    const result = await fileValidators.tutor.validate(URL_, fetcher);
    expect(result).toMatchObject({ ok: true, title: null, description: null, anonymous: true });
  });

  it("surfaces the structured errors on a failed build", async () => {
    mocks.loadAndBuildTutorPrompt.mockResolvedValue({
      ok: false,
      errors: [{ code: "X", message: "m" }],
    });
    expect(await fileValidators.tutor.validate(URL_, fetcher)).toEqual({
      ok: false,
      errors: [{ code: "X", message: "m" }],
    });
  });
});

describe("fileValidators.fragment", () => {
  it("validates with NO title/description and the privacy-safe anonymous default", async () => {
    mocks.loadAndCheckFragmentFile.mockResolvedValue({ ok: true, warnings: [] });
    expect(await fileValidators.fragment.validate(URL_, fetcher)).toEqual({
      ok: true,
      warnings: [],
      title: null,
      description: null,
      anonymous: true,
    });
  });

  it("propagates fragment errors", async () => {
    mocks.loadAndCheckFragmentFile.mockResolvedValue({
      ok: false,
      errors: [{ code: "F", message: "m" }],
    });
    expect(await fileValidators.fragment.validate(URL_, fetcher)).toEqual({
      ok: false,
      errors: [{ code: "F", message: "m" }],
    });
  });
});

describe("fileValidators.quiz (lenient stub — never blocks)", () => {
  it("extracts anonymous/title and emits the NOT_IMPLEMENTED warning", async () => {
    fetcher.mockResolvedValue({ ok: true, text: async () => "yaml" });
    mocks.parseQuiz.mockReturnValue({ ok: true, quiz: { anonymous: false, title: "Q" } });
    const result = await fileValidators.quiz.validate(URL_, fetcher);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.anonymous).toBe(false);
      expect(result.title).toBe("Q");
      expect(result.warnings.map((w) => w.code)).toContain("QUIZ_VALIDATION_NOT_IMPLEMENTED");
    }
  });

  it("keeps the privacy-safe defaults when the fetch fails", async () => {
    fetcher.mockResolvedValue({ ok: false });
    expect(await fileValidators.quiz.validate(URL_, fetcher)).toMatchObject({
      ok: true,
      anonymous: true,
      title: null,
    });
    expect(mocks.parseQuiz).not.toHaveBeenCalled();
  });

  it("stays lenient (ok) when the fetcher throws", async () => {
    fetcher.mockRejectedValue(new Error("network"));
    expect(await fileValidators.quiz.validate(URL_, fetcher)).toMatchObject({
      ok: true,
      anonymous: true,
      title: null,
    });
  });

  it("keeps defaults when the parse fails", async () => {
    fetcher.mockResolvedValue({ ok: true, text: async () => "bad" });
    mocks.parseQuiz.mockReturnValue({ ok: false });
    expect(await fileValidators.quiz.validate(URL_, fetcher)).toMatchObject({
      ok: true,
      anonymous: true,
      title: null,
    });
  });
});

describe("fileValidators.writing (lenient stub — never blocks)", () => {
  it("extracts anonymous/title and emits the NOT_IMPLEMENTED warning", async () => {
    fetcher.mockResolvedValue({ ok: true, text: async () => "yaml" });
    mocks.parseWriting.mockReturnValue({ ok: true, writing: { anonymous: false, title: "W" } });
    const result = await fileValidators.writing.validate(URL_, fetcher);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.anonymous).toBe(false);
      expect(result.title).toBe("W");
      expect(result.warnings.map((w) => w.code)).toContain("WRITING_VALIDATION_NOT_IMPLEMENTED");
    }
  });

  it("DEFAULTS anonymous to FALSE (the writing divergence) when the fetch fails", async () => {
    fetcher.mockResolvedValue({ ok: false });
    expect(await fileValidators.writing.validate(URL_, fetcher)).toMatchObject({
      ok: true,
      anonymous: false,
      title: null,
    });
    expect(mocks.parseWriting).not.toHaveBeenCalled();
  });

  it("stays lenient (ok, anonymous:false) when the fetcher throws", async () => {
    fetcher.mockRejectedValue(new Error("network"));
    expect(await fileValidators.writing.validate(URL_, fetcher)).toMatchObject({
      ok: true,
      anonymous: false,
      title: null,
    });
  });

  it("keeps the false default when the parse fails", async () => {
    fetcher.mockResolvedValue({ ok: true, text: async () => "bad" });
    mocks.parseWriting.mockReturnValue({ ok: false });
    expect(await fileValidators.writing.validate(URL_, fetcher)).toMatchObject({
      ok: true,
      anonymous: false,
      title: null,
    });
  });
});

describe("readAnonymousFlag (runtime-light, by FileKind)", () => {
  it("quiz → reads the live flag via loadQuiz (definitive)", async () => {
    mocks.loadQuiz.mockResolvedValue({ ok: true, quiz: { anonymous: false } });
    expect(await readAnonymousFlag("quiz", URL_)).toEqual({ anonymous: false, definitive: true });
    expect(mocks.loadQuiz).toHaveBeenCalledWith(URL_);
  });

  it("tutor → reads the built flag WITHOUT the heavy library check", async () => {
    mocks.loadAndBuildTutorPrompt.mockResolvedValue({ ok: true, anonymous: false });
    expect(await readAnonymousFlag("tutor", URL_)).toEqual({ anonymous: false, definitive: true });
    // Called with the default fetcher and NO { validateLibraries: true } option.
    expect(mocks.loadAndBuildTutorPrompt).toHaveBeenCalledWith(URL_, {});
  });

  it("writing → reads the live flag via loadWriting, DEFAULTING to false (definitive)", async () => {
    // parseWriting already defaults `anonymous` to false; readAnonymousFlag just
    // forwards the loaded flag definitively when the YAML reads.
    mocks.loadWriting.mockResolvedValue({ ok: true, writing: { anonymous: false } });
    expect(await readAnonymousFlag("writing", URL_)).toEqual({
      anonymous: false,
      definitive: true,
    });
    expect(mocks.loadWriting).toHaveBeenCalledWith(URL_);
  });

  it("writing → an explicit anonymous:true is carried through definitively", async () => {
    mocks.loadWriting.mockResolvedValue({ ok: true, writing: { anonymous: true } });
    expect(await readAnonymousFlag("writing", URL_)).toEqual({ anonymous: true, definitive: true });
  });

  it("writing → falls back to the privacy-safe default when the YAML cannot be read", async () => {
    mocks.loadWriting.mockResolvedValue({ ok: false, message: "gone" });
    expect(await readAnonymousFlag("writing", URL_)).toEqual({
      anonymous: true,
      definitive: false,
    });
  });

  it("falls back to anonymous:true NON-definitively when the YAML cannot be read", async () => {
    mocks.loadQuiz.mockResolvedValue({ ok: false, message: "gone" });
    expect(await readAnonymousFlag("quiz", URL_)).toEqual({ anonymous: true, definitive: false });
  });

  it("returns the non-definitive default for a kind with no anonymity flag (fragment)", async () => {
    expect(await readAnonymousFlag("fragment", URL_)).toEqual({
      anonymous: true,
      definitive: false,
    });
    expect(mocks.loadQuiz).not.toHaveBeenCalled();
    expect(mocks.loadAndBuildTutorPrompt).not.toHaveBeenCalled();
  });

  it("never throws — a throwing loader yields the non-definitive default", async () => {
    mocks.loadAndBuildTutorPrompt.mockRejectedValue(new Error("ECONNRESET"));
    expect(await readAnonymousFlag("tutor", URL_)).toEqual({ anonymous: true, definitive: false });
  });
});
