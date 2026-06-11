import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShareLinkAction } from "@/lib/share-link-actions";
import { signSharePayload } from "@/lib/share-links";

// The action is a thin shell around pure helpers (validation/signing) and the
// share-link store — these tests pin the wiring: who gets stored, and that
// storage failures degrade to a warning instead of blocking the teacher.

const mocks = vi.hoisted(() => ({
  requireEffectiveTeacher: vi.fn(),
  loadAndBuildTutorPrompt: vi.fn(),
  storeShareLink: vi.fn(),
  gcExpiredShareLinks: vi.fn(),
  // `after` runs its task once the response is sent; for the tests, running it
  // inline is close enough to assert WHAT gets scheduled.
  after: vi.fn((task: () => unknown) => {
    void task();
  }),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: "localhost:3000" })),
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/student-mode", () => ({
  requireEffectiveTeacher: mocks.requireEffectiveTeacher,
}));
vi.mock("@/lib/tutors", () => ({
  defaultFetcher: vi.fn(),
  loadAndBuildTutorPrompt: mocks.loadAndBuildTutorPrompt,
}));
vi.mock("@/lib/share-link-store", () => ({
  storeShareLink: mocks.storeShareLink,
  gcExpiredShareLinks: mocks.gcExpiredShareLinks,
}));

const SECRET = "action-test-secret";
const TUTOR = "https://example.com/tutor.yaml";
const START = 1_700_000_000;
const END = 1_700_003_600;

function formData(): FormData {
  const data = new FormData();
  data.set("tutor", TUTOR);
  data.set("startTs", String(START));
  data.set("endTs", String(END));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SHARE_LINK_SECRET", SECRET);
  vi.stubEnv("SHARE_LINK_ORIGIN", "");
  // The teacher guard RETURNS the session — the action must reuse it instead
  // of resolving the session a second time.
  mocks.requireEffectiveTeacher.mockResolvedValue({ user: { id: "teacher-sub-1" } });
  mocks.loadAndBuildTutorPrompt.mockResolvedValue({ ok: true, prompt: "p", warnings: [] });
  mocks.storeShareLink.mockResolvedValue({ stored: true, code: "abc123def4" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createShareLinkAction", () => {
  it("returns the full link plus the short link when the store succeeds", async () => {
    const state = await createShareLinkAction({ status: "idle" }, formData());
    expect(state).toMatchObject({
      status: "success",
      shortLink: "http://localhost:3000/?link=abc123def4",
    });
    expect(state.status === "success" && state.warning).toBeFalsy();
  });

  it("stores the signed pieces under the creating user's id", async () => {
    await createShareLinkAction({ status: "idle" }, formData());
    const payload = { tutor: TUTOR, start: START, end: END };
    expect(mocks.storeShareLink).toHaveBeenCalledWith("teacher-sub-1", {
      ...payload,
      sig: signSharePayload(payload, SECRET),
      origin: "http://localhost:3000",
    });
  });

  it("schedules expired-link GC off the response path after a successful store", async () => {
    await createShareLinkAction({ status: "idle" }, formData());
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.gcExpiredShareLinks).toHaveBeenCalledWith("teacher-sub-1");
  });

  it("still returns the full link with a warning when storing fails", async () => {
    mocks.storeShareLink.mockResolvedValue({ stored: false });
    const state = await createShareLinkAction({ status: "idle" }, formData());
    expect(state.status).toBe("success");
    if (state.status !== "success") return;
    expect(state.link).toContain(`?tutor=`);
    expect(state.shortLink).toBeUndefined();
    expect(state.warning).toMatch(/could not be stored/);
    // Nothing was stored, so there is nothing to garbage-collect.
    expect(mocks.gcExpiredShareLinks).not.toHaveBeenCalled();
  });

  it("degrades without a session user id and never touches the store", async () => {
    mocks.requireEffectiveTeacher.mockResolvedValue({ user: {} });
    const state = await createShareLinkAction({ status: "idle" }, formData());
    expect(state).toMatchObject({ status: "success", warning: expect.any(String) });
    expect(mocks.storeShareLink).not.toHaveBeenCalled();
    expect(mocks.gcExpiredShareLinks).not.toHaveBeenCalled();
  });

  it("rejects non-teachers before doing anything", async () => {
    mocks.requireEffectiveTeacher.mockRejectedValue(new Error("nope"));
    const state = await createShareLinkAction({ status: "idle" }, formData());
    expect(state).toEqual({ status: "error", message: "Only teachers can create share links." });
    expect(mocks.storeShareLink).not.toHaveBeenCalled();
  });
});
