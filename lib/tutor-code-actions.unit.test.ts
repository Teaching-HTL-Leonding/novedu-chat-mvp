import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The action is a thin shell around the pure validation and the tutor-code
// store — these tests pin the wiring: what gets stored under whose user id,
// and that a storage failure is a HARD error (there is no stateless fallback
// to degrade to anymore).

const mocks = vi.hoisted(() => ({
  requireTeacherUserId: vi.fn(),
  loadAndBuildTutorPrompt: vi.fn(),
  createTutorCode: vi.fn(),
  getOwnedTutorCode: vi.fn(),
  deleteTutorCodeAndData: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: "localhost:3000" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/student-mode", () => ({
  requireTeacherUserId: mocks.requireTeacherUserId,
}));
vi.mock("@/lib/tutors", () => ({
  defaultFetcher: vi.fn(),
  loadAndBuildTutorPrompt: mocks.loadAndBuildTutorPrompt,
}));
vi.mock("@/lib/tutor-code-store", async (importOriginal) => {
  // Keep the REAL validateTutorCodeRequest — the action's validation behavior
  // is part of the contract under test; only the storage calls are mocked.
  const actual = await importOriginal<typeof import("@/lib/tutor-code-store")>();
  return {
    ...actual,
    createTutorCode: mocks.createTutorCode,
    getOwnedTutorCode: mocks.getOwnedTutorCode,
  };
});
// The destructive store is fully mocked — it pulls in @/app/mastra otherwise.
vi.mock("@/lib/tutor-stats-store", () => ({
  deleteTutorCodeAndData: mocks.deleteTutorCodeAndData,
}));
// validateTutorCodeRequest (imported for real above) pulls in @/lib/db, which
// must not try to talk to a database in unit tests.
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));

import { createTutorCodeAction, deleteTutorCodeAction } from "@/lib/tutor-code-actions";

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
  // The shared gate yields the teacher's user id directly (no separate session
  // round trip); the action reuses it.
  mocks.requireTeacherUserId.mockResolvedValue({ ok: true, userId: "teacher-sub-1" });
  mocks.loadAndBuildTutorPrompt.mockResolvedValue({
    ok: true,
    prompt: "p",
    warnings: [],
    anonymous: true,
  });
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
      anonymous: true,
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
    mocks.requireTeacherUserId.mockResolvedValue({ ok: false, reason: "not-teacher" });
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

  it("rejects a tutor that fails validation, surfacing the full structured error list", async () => {
    // The action forwards the validator's errors verbatim (not just the first
    // one's message) so the form can render code + field-path detail.
    mocks.loadAndBuildTutorPrompt.mockResolvedValue({
      ok: false,
      errors: [
        {
          code: "TUTOR_SCHEMA_ERROR",
          message: "Document does not match the expected structure",
          zodIssues: { errors: ['Unrecognized key: "nae"'] },
        },
      ],
      warnings: [],
    });
    const state = await createTutorCodeAction({ status: "idle" }, formData());
    expect(state).toMatchObject({
      status: "error",
      errors: [{ code: "TUTOR_SCHEMA_ERROR", zodIssues: { errors: ['Unrecognized key: "nae"'] } }],
    });
    expect(mocks.createTutorCode).not.toHaveBeenCalled();
  });

  it("errors when no session user id is available", async () => {
    mocks.requireTeacherUserId.mockResolvedValue({ ok: false, reason: "no-user-id" });
    const state = await createTutorCodeAction({ status: "idle" }, formData());
    expect(state).toMatchObject({ status: "error", message: expect.stringMatching(/sign in/i) });
  });
});

describe("deleteTutorCodeAction", () => {
  const ownedEntry = { code: "a1b2c3d4e5", createdBy: "teacher-sub-1" };

  it("deletes the code and revalidates the list when the teacher owns it", async () => {
    mocks.getOwnedTutorCode.mockResolvedValue(ownedEntry);
    mocks.deleteTutorCodeAndData.mockResolvedValue(true);

    const result = await deleteTutorCodeAction("a1b2c3d4e5");

    expect(result).toEqual({ ok: true });
    expect(mocks.getOwnedTutorCode).toHaveBeenCalledWith("a1b2c3d4e5", "teacher-sub-1");
    expect(mocks.deleteTutorCodeAndData).toHaveBeenCalledWith("a1b2c3d4e5");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/tutor-codes");
  });

  it("rejects non-teachers and never touches the data", async () => {
    mocks.requireTeacherUserId.mockResolvedValue({ ok: false, reason: "not-teacher" });
    const result = await deleteTutorCodeAction("a1b2c3d4e5");
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/teachers/i) });
    expect(mocks.deleteTutorCodeAndData).not.toHaveBeenCalled();
  });

  it("refuses to delete a code the teacher does not own (treated as already gone)", async () => {
    mocks.getOwnedTutorCode.mockResolvedValue(null);
    const result = await deleteTutorCodeAction("a1b2c3d4e5");
    // Owner-gated: a foreign/unknown code is a no-op success so the row clears,
    // but the destructive delete must NOT run.
    expect(result).toEqual({ ok: true });
    expect(mocks.deleteTutorCodeAndData).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/tutor-codes");
  });

  it("surfaces a retry hint when the ownership check itself fails", async () => {
    mocks.getOwnedTutorCode.mockResolvedValue(undefined);
    const result = await deleteTutorCodeAction("a1b2c3d4e5");
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/try again/i) });
    expect(mocks.deleteTutorCodeAndData).not.toHaveBeenCalled();
  });

  it("reports failure (no revalidate) when the delete is only partial", async () => {
    mocks.getOwnedTutorCode.mockResolvedValue(ownedEntry);
    mocks.deleteTutorCodeAndData.mockResolvedValue(false);
    const result = await deleteTutorCodeAction("a1b2c3d4e5");
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/repeat/i) });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
