import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The action is a thin shell around the pure validation and the tutor-code
// store — these tests pin the wiring: what gets stored under whose user id,
// and that a storage failure is a HARD error (there is no stateless fallback
// to degrade to anymore).

const mocks = vi.hoisted(() => ({
  requireEffectiveTeacher: vi.fn(),
  loadAndBuildTutorPrompt: vi.fn(),
  createTutorCode: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: "localhost:3000" })),
}));
vi.mock("@/lib/student-mode", () => ({
  requireEffectiveTeacher: mocks.requireEffectiveTeacher,
}));
vi.mock("@/lib/tutors", () => ({
  defaultFetcher: vi.fn(),
  loadAndBuildTutorPrompt: mocks.loadAndBuildTutorPrompt,
}));
vi.mock("@/lib/tutor-code-store", async (importOriginal) => {
  // Keep the REAL validateTutorCodeRequest — the action's validation behavior
  // is part of the contract under test; only the storage call is mocked.
  const actual = await importOriginal<typeof import("@/lib/tutor-code-store")>();
  return { ...actual, createTutorCode: mocks.createTutorCode };
});
// validateTutorCodeRequest (imported for real above) pulls in @/lib/db, which
// must not try to talk to a database in unit tests.
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));

import { createTutorCodeAction } from "@/lib/tutor-code-actions";

const TUTOR = "https://example.com/tutor.yaml";
const START = 1_700_000_000;
const END = 1_700_003_600;

function formData(note = "My class"): FormData {
  const data = new FormData();
  data.set("tutor", TUTOR);
  data.set("startTs", String(START));
  data.set("endTs", String(END));
  data.set("note", note);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TUTOR_CODE_ORIGIN", "");
  // The teacher guard RETURNS the session — the action must reuse it instead
  // of resolving the session a second time.
  mocks.requireEffectiveTeacher.mockResolvedValue({ user: { id: "teacher-sub-1" } });
  mocks.loadAndBuildTutorPrompt.mockResolvedValue({ ok: true, prompt: "p", warnings: [] });
  mocks.createTutorCode.mockResolvedValue({ stored: true, code: "abc123def4" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createTutorCodeAction", () => {
  it("returns the chat URL for the stored code", async () => {
    const state = await createTutorCodeAction({ status: "idle" }, formData());
    expect(state).toEqual({
      status: "success",
      link: "http://localhost:3000/abc123def4",
      note: "My class",
    });
  });

  it("stores the validated payload under the creating teacher's user id", async () => {
    await createTutorCodeAction({ status: "idle" }, formData("  trimmed note  "));
    expect(mocks.createTutorCode).toHaveBeenCalledWith("teacher-sub-1", {
      tutorUrl: TUTOR,
      validFrom: new Date(START * 1000),
      validUntil: new Date(END * 1000),
      note: "trimmed note",
      origin: "http://localhost:3000",
    });
  });

  it("prefers TUTOR_CODE_ORIGIN over request headers for the displayed URL", async () => {
    vi.stubEnv("TUTOR_CODE_ORIGIN", "https://chat.example.org");
    const state = await createTutorCodeAction({ status: "idle" }, formData());
    expect(state).toMatchObject({ status: "success", link: "https://chat.example.org/abc123def4" });
  });

  it("is a HARD error when the code cannot be stored (no stateless fallback)", async () => {
    mocks.createTutorCode.mockResolvedValue({ stored: false });
    const state = await createTutorCodeAction({ status: "idle" }, formData());
    expect(state).toMatchObject({
      status: "error",
      message: expect.stringMatching(/could not be stored/i),
    });
  });

  it("rejects non-teachers", async () => {
    mocks.requireEffectiveTeacher.mockRejectedValue(new Error("nope"));
    const state = await createTutorCodeAction({ status: "idle" }, formData());
    expect(state).toMatchObject({ status: "error", message: expect.stringMatching(/teachers/i) });
    expect(mocks.createTutorCode).not.toHaveBeenCalled();
  });

  it("surfaces validation errors without touching storage", async () => {
    const data = formData();
    data.set("tutor", "not a url");
    const state = await createTutorCodeAction({ status: "idle" }, data);
    expect(state).toMatchObject({ status: "error" });
    expect(mocks.createTutorCode).not.toHaveBeenCalled();
  });

  it("rejects a tutor that fails validation at create time", async () => {
    mocks.loadAndBuildTutorPrompt.mockResolvedValue({
      ok: false,
      errors: [{ code: "FETCH_FAILED", message: "HTTP 404" }],
      warnings: [],
    });
    const state = await createTutorCodeAction({ status: "idle" }, formData());
    expect(state).toMatchObject({
      status: "error",
      message: expect.stringContaining("FETCH_FAILED"),
    });
    expect(mocks.createTutorCode).not.toHaveBeenCalled();
  });

  it("errors when no session user id is available", async () => {
    mocks.requireEffectiveTeacher.mockResolvedValue({ user: {} });
    const state = await createTutorCodeAction({ status: "idle" }, formData());
    expect(state).toMatchObject({ status: "error", message: expect.stringMatching(/sign in/i) });
  });
});
