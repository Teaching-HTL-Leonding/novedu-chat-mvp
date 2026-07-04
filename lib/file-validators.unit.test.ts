import { beforeEach, describe, expect, it, vi } from "vitest";

// Layer-2 validator seam + the runtime-light readAnonymousFlag, both keyed by
// FileKind. The underlying loaders (lib/tutors, lib/quiz-validate, lib/quiz-fetch,
// lib/writing-validate, lib/writing-fetch) are mocked so this is hermetic — it
// asserts the MAPPING each kind performs (which loader, which options, how the
// result is shaped), not the validation itself.

const mocks = vi.hoisted(() => ({
  loadAndBuildTutorPrompt: vi.fn(),
  loadAndCheckFragmentFile: vi.fn(),
  loadQuiz: vi.fn(),
  loadAndCheckQuiz: vi.fn(),
  loadWriting: vi.fn(),
  loadAndCheckWriting: vi.fn(),
  loadAndCheckCoding: vi.fn(),
}));

vi.mock("@/lib/tutors", () => ({
  defaultFetcher: {},
  loadAndBuildTutorPrompt: mocks.loadAndBuildTutorPrompt,
  loadAndCheckFragmentFile: mocks.loadAndCheckFragmentFile,
}));
vi.mock("@/lib/quiz-fetch", () => ({ loadQuiz: mocks.loadQuiz }));
vi.mock("@/lib/quiz-validate", () => ({ loadAndCheckQuiz: mocks.loadAndCheckQuiz }));
vi.mock("@/lib/writing-fetch", () => ({ loadWriting: mocks.loadWriting }));
vi.mock("@/lib/writing-validate", () => ({ loadAndCheckWriting: mocks.loadAndCheckWriting }));
vi.mock("@/lib/coding-validate", () => ({ loadAndCheckCoding: mocks.loadAndCheckCoding }));

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

describe("fileValidators.quiz (strict gate — blocks an invalid quiz)", () => {
  it("delegates to loadAndCheckQuiz and maps title/anonymous + warnings", async () => {
    mocks.loadAndCheckQuiz.mockResolvedValue({
      ok: true,
      warnings: ["w"],
      anonymous: false,
      title: "Q",
      quizId: "q",
      model: "m",
      questionCount: 3,
    });
    const result = await fileValidators.quiz.validate(URL_, fetcher);
    expect(mocks.loadAndCheckQuiz).toHaveBeenCalledWith(URL_, fetcher);
    expect(result).toEqual({
      ok: true,
      warnings: ["w"],
      title: "Q",
      description: null,
      anonymous: false,
    });
  });

  it("propagates the structured errors on a failed check (blocks the save)", async () => {
    mocks.loadAndCheckQuiz.mockResolvedValue({
      ok: false,
      errors: [{ code: "QUIZ_SCHEMA_ERROR", message: "m" }],
      warnings: [],
    });
    expect(await fileValidators.quiz.validate(URL_, fetcher)).toEqual({
      ok: false,
      errors: [{ code: "QUIZ_SCHEMA_ERROR", message: "m" }],
    });
  });
});

describe("fileValidators.writing (strict gate — blocks an invalid activity)", () => {
  it("delegates to loadAndCheckWriting and maps title/anonymous + warnings", async () => {
    mocks.loadAndCheckWriting.mockResolvedValue({
      ok: true,
      warnings: [],
      anonymous: false,
      title: "W",
      writingId: "w",
      model: "m",
    });
    const result = await fileValidators.writing.validate(URL_, fetcher);
    expect(mocks.loadAndCheckWriting).toHaveBeenCalledWith(URL_, fetcher);
    expect(result).toEqual({
      ok: true,
      warnings: [],
      title: "W",
      description: null,
      anonymous: false,
    });
  });

  it("propagates the structured errors on a failed check (blocks the save)", async () => {
    mocks.loadAndCheckWriting.mockResolvedValue({
      ok: false,
      errors: [{ code: "WRITING_SCHEMA_ERROR", message: "m" }],
      warnings: [],
    });
    expect(await fileValidators.writing.validate(URL_, fetcher)).toEqual({
      ok: false,
      errors: [{ code: "WRITING_SCHEMA_ERROR", message: "m" }],
    });
  });
});

describe("fileValidators.coding", () => {
  it("validates via loadAndCheckCoding and FREEZES anonymous:true (coding is always anonymous)", async () => {
    mocks.loadAndCheckCoding.mockResolvedValue({ ok: true, warnings: ["w"], title: "T" });
    const result = await fileValidators.coding.validate(URL_, fetcher);
    expect(mocks.loadAndCheckCoding).toHaveBeenCalledWith(URL_, fetcher);
    expect(result).toEqual({
      ok: true,
      warnings: ["w"],
      title: "T",
      description: null,
      // Frozen regardless of the file — the API path carries no per-student identity.
      anonymous: true,
    });
  });

  it("carries no description and defaults title to null", async () => {
    mocks.loadAndCheckCoding.mockResolvedValue({ ok: true, warnings: [], title: null });
    expect(await fileValidators.coding.validate(URL_, fetcher)).toMatchObject({
      ok: true,
      title: null,
      description: null,
      anonymous: true,
    });
  });

  it("surfaces the structured errors on a failed check (BLOCKS the save)", async () => {
    mocks.loadAndCheckCoding.mockResolvedValue({
      ok: false,
      errors: [{ code: "CODING_SCHEMA_ERROR", message: "m" }],
      warnings: [],
    });
    expect(await fileValidators.coding.validate(URL_, fetcher)).toEqual({
      ok: false,
      errors: [{ code: "CODING_SCHEMA_ERROR", message: "m" }],
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

  it("coding → always anonymous:true definitively, WITHOUT reading the YAML", async () => {
    expect(await readAnonymousFlag("coding", URL_)).toEqual({ anonymous: true, definitive: true });
    // Coding is anonymous by construction — no loader is consulted.
    expect(mocks.loadQuiz).not.toHaveBeenCalled();
    expect(mocks.loadWriting).not.toHaveBeenCalled();
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
