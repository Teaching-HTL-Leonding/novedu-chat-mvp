import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// createQuizLinkAction is a thin shell over the (separately tested) pure
// validateQuizLinkRequest + buildQuizLink: this pins the wiring — the teacher
// gate, the validation pass-through, and that a success returns a signed /q link.

const mocks = vi.hoisted(() => ({
  requireEffectiveTeacher: vi.fn(),
  resolveAppOrigin: vi.fn(),
}));

vi.mock("@/lib/student-mode", () => ({ requireEffectiveTeacher: mocks.requireEffectiveTeacher }));
vi.mock("@/lib/app-origin", () => ({ resolveAppOrigin: mocks.resolveAppOrigin }));

import { verifyQuizLink } from "@/lib/quiz-link";
import { createQuizLinkAction } from "@/lib/quiz-link-actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_SECRET", "test-auth-secret");
  mocks.requireEffectiveTeacher.mockResolvedValue({ user: { id: "teacher-1" } });
  mocks.resolveAppOrigin.mockResolvedValue("https://app.example");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("createQuizLinkAction", () => {
  it("rejects a non-teacher before doing anything", async () => {
    mocks.requireEffectiveTeacher.mockRejectedValue(new Error("forbidden"));
    const result = await createQuizLinkAction(
      { status: "idle" },
      form({ quiz: "https://x/q", startTs: "1000", endTs: "2000" }),
    );
    expect(result).toMatchObject({ status: "error", message: expect.stringMatching(/teachers/i) });
    expect(mocks.resolveAppOrigin).not.toHaveBeenCalled();
  });

  it("rejects an invalid URL", async () => {
    const result = await createQuizLinkAction(
      { status: "idle" },
      form({ quiz: "not-a-url", startTs: "1000", endTs: "2000" }),
    );
    expect(result.status).toBe("error");
  });

  it("rejects end <= start", async () => {
    const result = await createQuizLinkAction(
      { status: "idle" },
      form({ quiz: "https://x/q", startTs: "2000", endTs: "2000" }),
    );
    expect(result.status).toBe("error");
  });

  it("signs a verifiable /q link on success", async () => {
    const result = await createQuizLinkAction(
      { status: "idle" },
      form({ quiz: "https://x/api/files/q", startTs: "1000", endTs: "2000" }),
    );
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    const url = new URL(result.link);
    expect(url.origin).toBe("https://app.example");
    expect(url.pathname).toBe("/q");
    // The signature must verify against the same AUTH_SECRET-derived secret.
    const { getQuizLinkSecret, resetQuizLinkSecretForTests } = await import("@/lib/quiz-link");
    resetQuizLinkSecretForTests();
    const verification = verifyQuizLink(
      {
        quiz: url.searchParams.get("quiz"),
        start: url.searchParams.get("start"),
        end: url.searchParams.get("end"),
        sig: url.searchParams.get("sig"),
      },
      getQuizLinkSecret(),
      1500,
    );
    expect(verification.ok).toBe(true);
  });

  it("errors clearly when the app origin cannot be resolved", async () => {
    mocks.resolveAppOrigin.mockRejectedValue(new Error("no host"));
    const result = await createQuizLinkAction(
      { status: "idle" },
      form({ quiz: "https://x/q", startTs: "1000", endTs: "2000" }),
    );
    expect(result).toMatchObject({
      status: "error",
      message: expect.stringMatching(/public address/i),
    });
  });
});
