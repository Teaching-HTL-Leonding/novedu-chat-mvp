// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The Settings page's actions: each acts ONLY on the session user's own row (the
// user id is never client-supplied), validates its input against a strict
// schema, and invalidates the user's cached start page. The stores and the
// session are mocked.

const getSession = vi.hoisted(() => vi.fn());
const storeSettings = vi.hoisted(() => vi.fn());
const deleteOwnQuizResults = vi.hoisted(() => vi.fn());
const invalidateHome = vi.hoisted(() => vi.fn());

vi.mock("@/lib/session", () => ({ getSession }));
vi.mock("@/lib/user-settings-store", () => ({ updateUserSettings: storeSettings }));
vi.mock("@/lib/quiz-result-store", () => ({ deleteOwnQuizResults }));
vi.mock("@/lib/home-data", () => ({ invalidateHome }));

import { deleteMyQuizResults, updateUserSettings } from "@/lib/user-settings-actions";

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: "u1" } });
  storeSettings.mockResolvedValue(true);
  deleteOwnQuizResults.mockResolvedValue(3);
});

describe("updateUserSettings", () => {
  it("upserts the session user's row and invalidates their home", async () => {
    await expect(updateUserSettings({ saveQuizResults: true })).resolves.toEqual({ ok: true });
    expect(storeSettings).toHaveBeenCalledWith("u1", { saveQuizResults: true });
    expect(invalidateHome).toHaveBeenCalledWith("u1");
  });

  it.each([
    ["an unknown field", { saveQuizResults: true, userId: "someone-else" }],
    ["a wrong type", { saveQuizResults: "yes" }],
    ["no field at all", {}],
    ["not an object", "saveQuizResults"],
    ["null", null],
  ])("rejects %s without touching the store", async (_name, patch) => {
    const result = await updateUserSettings(patch);
    expect(result.ok).toBe(false);
    expect(storeSettings).not.toHaveBeenCalled();
  });

  it("needs a session", async () => {
    getSession.mockResolvedValue(null);
    await expect(updateUserSettings({ saveQuizResults: true })).resolves.toMatchObject({
      ok: false,
    });
    expect(storeSettings).not.toHaveBeenCalled();
  });

  it("reports a store failure as a message", async () => {
    storeSettings.mockResolvedValue(false);
    await expect(updateUserSettings({ saveQuizResults: false })).resolves.toMatchObject({
      ok: false,
    });
    expect(invalidateHome).not.toHaveBeenCalled();
  });
});

describe("deleteMyQuizResults", () => {
  it("deletes only the session user's results and invalidates their home", async () => {
    await expect(deleteMyQuizResults()).resolves.toEqual({ ok: true, deleted: 3 });
    expect(deleteOwnQuizResults).toHaveBeenCalledWith("u1");
    expect(invalidateHome).toHaveBeenCalledWith("u1");
  });

  it("needs a session and reports a store failure as a message", async () => {
    deleteOwnQuizResults.mockResolvedValue(undefined);
    await expect(deleteMyQuizResults()).resolves.toMatchObject({ ok: false });
    getSession.mockResolvedValue(null);
    deleteOwnQuizResults.mockClear();
    await expect(deleteMyQuizResults()).resolves.toMatchObject({ ok: false });
    expect(deleteOwnQuizResults).not.toHaveBeenCalled();
  });
});
