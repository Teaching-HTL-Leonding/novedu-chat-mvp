import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The actions are thin shells around the pure validation and the tutor-code
// store — these tests pin the wiring: what gets stored under whose user id, that
// create redirects to the new code's edit page, that edit saves only the
// window+note, and that delete is teacher-gated (but NOT owner-gated — any
// effective teacher may delete any code).

const mocks = vi.hoisted(() => ({
  requireTeacherUserId: vi.fn(),
  loadAndBuildTutorPrompt: vi.fn(),
  createTutorCode: vi.fn(),
  getTutorCode: vi.fn(),
  updateTutorCode: vi.fn(),
  deleteTutorCodeAndData: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: "localhost:3000" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/student-mode", () => ({
  requireTeacherUserId: mocks.requireTeacherUserId,
}));
vi.mock("@/lib/tutors", () => ({
  defaultFetcher: vi.fn(),
  loadAndBuildTutorPrompt: mocks.loadAndBuildTutorPrompt,
}));
vi.mock("@/lib/tutor-code-store", async (importOriginal) => {
  // Keep the REAL validateTutorCodeRequest — the actions' validation behavior is
  // part of the contract under test; only the storage calls are mocked.
  const actual = await importOriginal<typeof import("@/lib/tutor-code-store")>();
  return {
    ...actual,
    createTutorCode: mocks.createTutorCode,
    getTutorCode: mocks.getTutorCode,
    updateTutorCode: mocks.updateTutorCode,
  };
});
// The destructive store is fully mocked — it pulls in @/app/mastra otherwise.
vi.mock("@/lib/tutor-stats-store", () => ({
  deleteTutorCodeAndData: mocks.deleteTutorCodeAndData,
}));
// validateTutorCodeRequest (imported for real above) pulls in @/lib/db, which
// must not try to talk to a database in unit tests.
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));

import {
  createTutorCodeAction,
  deleteTutorCodeAction,
  updateTutorCodeAction,
} from "@/lib/tutor-code-actions";

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
  it("redirects to the new code's edit page on success", async () => {
    await createTutorCodeAction({ status: "idle" }, formData());
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/tutor-codes");
    expect(mocks.redirect).toHaveBeenCalledWith("/tutor-codes/edit/abc123def4");
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

  it("is a HARD error when the code cannot be stored (no stateless fallback)", async () => {
    mocks.createTutorCode.mockResolvedValue({ stored: false });
    const state = await createTutorCodeAction({ status: "idle" }, formData());
    expect(state).toMatchObject({
      status: "error",
      message: expect.stringMatching(/could not be stored/i),
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
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

describe("updateTutorCodeAction", () => {
  const entry = { code: "a1b2c3d4e5", createdBy: "someone-else", tutorUrl: TUTOR, anonymous: true };

  beforeEach(() => {
    mocks.getTutorCode.mockResolvedValue(entry);
    mocks.updateTutorCode.mockResolvedValue({ ok: true });
  });

  it("saves the window + note (URL never submitted) and revalidates", async () => {
    const state = await updateTutorCodeAction(
      "a1b2c3d4e5",
      { status: "idle" },
      formData("  new  "),
    );
    expect(state).toEqual({ status: "saved" });
    expect(mocks.updateTutorCode).toHaveBeenCalledWith("a1b2c3d4e5", {
      validFrom: new Date(START * 1000),
      validUntil: new Date(END * 1000),
      note: "new",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/tutor-codes");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/tutor-codes/edit/a1b2c3d4e5");
  });

  it("does not require ownership — any effective teacher may edit any code", async () => {
    // The entry's createdBy is a different teacher; the edit still goes through.
    const state = await updateTutorCodeAction("a1b2c3d4e5", { status: "idle" }, formData());
    expect(state).toEqual({ status: "saved" });
  });

  it("rejects non-teachers and never writes", async () => {
    mocks.requireTeacherUserId.mockResolvedValue({ ok: false, reason: "not-teacher" });
    const state = await updateTutorCodeAction("a1b2c3d4e5", { status: "idle" }, formData());
    expect(state).toMatchObject({ status: "error", message: expect.stringMatching(/teachers/i) });
    expect(mocks.updateTutorCode).not.toHaveBeenCalled();
  });

  it("errors when the code no longer exists", async () => {
    mocks.getTutorCode.mockResolvedValue(null);
    const state = await updateTutorCodeAction("a1b2c3d4e5", { status: "idle" }, formData());
    expect(state).toMatchObject({ status: "error", message: expect.stringMatching(/no longer/i) });
    expect(mocks.updateTutorCode).not.toHaveBeenCalled();
  });

  it("surfaces a retry hint when the lookup itself fails", async () => {
    mocks.getTutorCode.mockResolvedValue(undefined);
    const state = await updateTutorCodeAction("a1b2c3d4e5", { status: "idle" }, formData());
    expect(state).toMatchObject({ status: "error", message: expect.stringMatching(/try again/i) });
    expect(mocks.updateTutorCode).not.toHaveBeenCalled();
  });

  it("surfaces validation errors (e.g. end before start) without writing", async () => {
    const data = formData();
    data.set("startTs", String(END));
    data.set("endTs", String(START));
    const state = await updateTutorCodeAction("a1b2c3d4e5", { status: "idle" }, data);
    expect(state).toMatchObject({ status: "error" });
    expect(mocks.updateTutorCode).not.toHaveBeenCalled();
  });
});

describe("deleteTutorCodeAction", () => {
  it("deletes the code and revalidates — no ownership check (any teacher)", async () => {
    mocks.deleteTutorCodeAndData.mockResolvedValue(true);

    const result = await deleteTutorCodeAction("a1b2c3d4e5");

    expect(result).toEqual({ ok: true });
    expect(mocks.deleteTutorCodeAndData).toHaveBeenCalledWith("a1b2c3d4e5");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/tutor-codes");
  });

  it("rejects non-teachers and never touches the data", async () => {
    mocks.requireTeacherUserId.mockResolvedValue({ ok: false, reason: "not-teacher" });
    const result = await deleteTutorCodeAction("a1b2c3d4e5");
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/teachers/i) });
    expect(mocks.deleteTutorCodeAndData).not.toHaveBeenCalled();
  });

  it("reports failure (no revalidate) when the delete is only partial", async () => {
    mocks.deleteTutorCodeAndData.mockResolvedValue(false);
    const result = await deleteTutorCodeAction("a1b2c3d4e5");
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/repeat/i) });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
