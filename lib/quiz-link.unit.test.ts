import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildQuizLink,
  getQuizLinkSecret,
  type QuizLinkPayload,
  resetQuizLinkSecretForTests,
  signQuizPayload,
  validateQuizLinkRequest,
  verifyQuizLink,
} from "@/lib/quiz-link";

const SECRET = "test-secret";
const PAYLOAD: QuizLinkPayload = {
  quiz: "https://example.com/api/files/my-quiz",
  start: 1_000,
  end: 2_000,
};
const NOW = 1_500; // inside [start, end]

function signed(payload: QuizLinkPayload = PAYLOAD) {
  return { ...payload, sig: signQuizPayload(payload, SECRET) };
}

describe("signQuizPayload / verifyQuizLink", () => {
  it("verifies a freshly signed link inside the window", () => {
    const result = verifyQuizLink(
      {
        quiz: PAYLOAD.quiz,
        start: String(PAYLOAD.start),
        end: String(PAYLOAD.end),
        sig: signQuizPayload(PAYLOAD, SECRET),
      },
      SECRET,
      NOW,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.quiz).toBe(PAYLOAD.quiz);
  });

  it("rejects a tampered quiz URL (signature mismatch)", () => {
    const s = signed();
    const result = verifyQuizLink(
      { quiz: "https://evil.example/quiz", start: String(s.start), end: String(s.end), sig: s.sig },
      SECRET,
      NOW,
    );
    expect(result).toEqual({ ok: false, reason: "invalid-signature" });
  });

  it("rejects a widened window (signature mismatch)", () => {
    const s = signed();
    const result = verifyQuizLink(
      { quiz: s.quiz, start: String(s.start), end: "999999999", sig: s.sig },
      SECRET,
      NOW,
    );
    expect(result).toEqual({ ok: false, reason: "invalid-signature" });
  });

  it("rejects a link signed with a different secret", () => {
    const sig = signQuizPayload(PAYLOAD, "other-secret");
    const result = verifyQuizLink(
      { quiz: PAYLOAD.quiz, start: String(PAYLOAD.start), end: String(PAYLOAD.end), sig },
      SECRET,
      NOW,
    );
    expect(result).toEqual({ ok: false, reason: "invalid-signature" });
  });

  it.each([
    ["missing quiz", { start: "1000", end: "2000", sig: "ab" }],
    ["empty quiz", { quiz: "", start: "1000", end: "2000", sig: "ab" }],
    ["non-digit start", { quiz: "q", start: "12x", end: "2000", sig: "ab" }],
    ["non-digit end", { quiz: "q", start: "1000", end: "x", sig: "ab" }],
    ["missing sig", { quiz: "q", start: "1000", end: "2000" }],
  ])("reports missing-params: %s", (_label, params) => {
    expect(verifyQuizLink(params, SECRET, NOW)).toEqual({ ok: false, reason: "missing-params" });
  });

  it("reports not-started before the window, with bounds", () => {
    const s = signed();
    const result = verifyQuizLink(
      { quiz: s.quiz, start: String(s.start), end: String(s.end), sig: s.sig },
      SECRET,
      PAYLOAD.start - 1,
    );
    expect(result).toEqual({
      ok: false,
      reason: "not-started",
      start: PAYLOAD.start,
      end: PAYLOAD.end,
    });
  });

  it("reports expired after the window, with bounds", () => {
    const s = signed();
    const result = verifyQuizLink(
      { quiz: s.quiz, start: String(s.start), end: String(s.end), sig: s.sig },
      SECRET,
      PAYLOAD.end + 1,
    );
    expect(result).toEqual({
      ok: false,
      reason: "expired",
      start: PAYLOAD.start,
      end: PAYLOAD.end,
    });
  });

  it("treats both bounds as inclusive", () => {
    const s = signed();
    const at = (now: number) =>
      verifyQuizLink(
        { quiz: s.quiz, start: String(s.start), end: String(s.end), sig: s.sig },
        SECRET,
        now,
      ).ok;
    expect(at(PAYLOAD.start)).toBe(true);
    expect(at(PAYLOAD.end)).toBe(true);
  });

  it("rejects non-hex / padded signatures", () => {
    const s = signed();
    const tamper = (sig: string) =>
      verifyQuizLink(
        { quiz: s.quiz, start: String(s.start), end: String(s.end), sig },
        SECRET,
        NOW,
      );
    expect(tamper(`${s.sig}zz`)).toEqual({ ok: false, reason: "invalid-signature" });
    expect(tamper(s.sig.slice(0, -2))).toEqual({ ok: false, reason: "invalid-signature" });
  });
});

describe("canonicalQuizPayload", () => {
  it("is injective even when the quiz URL contains &start=", () => {
    // A quiz URL embedding "&start=" must not be re-splittable into a different
    // (quiz, start, end) — the digit guard on start/end is what prevents it.
    const tricky: QuizLinkPayload = {
      quiz: "https://x/q?a=1&start=9",
      start: 1000,
      end: 2000,
    };
    const sig = signQuizPayload(tricky, SECRET);
    // The honest parse verifies…
    expect(
      verifyQuizLink({ quiz: tricky.quiz, start: "1000", end: "2000", sig }, SECRET, NOW).ok,
    ).toBe(true);
    // …and a malicious re-split (quiz="https://x/q?a=1", start="9") does not.
    expect(
      verifyQuizLink({ quiz: "https://x/q?a=1", start: "9", end: "2000", sig }, SECRET, NOW).ok,
    ).toBe(false);
  });
});

describe("buildQuizLink", () => {
  it("builds an absolute /q link with all four params", () => {
    const link = buildQuizLink("https://app.example", PAYLOAD, SECRET);
    const url = new URL(link);
    expect(url.origin).toBe("https://app.example");
    expect(url.pathname).toBe("/q");
    expect(url.searchParams.get("quiz")).toBe(PAYLOAD.quiz);
    expect(url.searchParams.get("start")).toBe("1000");
    expect(url.searchParams.get("end")).toBe("2000");
    expect(url.searchParams.get("sig")).toBe(signQuizPayload(PAYLOAD, SECRET));
  });

  it("falls back to a root-relative link when no origin is given", () => {
    const link = buildQuizLink("", PAYLOAD, SECRET);
    expect(link.startsWith("/q?")).toBe(true);
  });

  it("round-trips through verifyQuizLink", () => {
    const link = buildQuizLink("https://app.example", PAYLOAD, SECRET);
    const url = new URL(link);
    const result = verifyQuizLink(
      {
        quiz: url.searchParams.get("quiz"),
        start: url.searchParams.get("start"),
        end: url.searchParams.get("end"),
        sig: url.searchParams.get("sig"),
      },
      SECRET,
      NOW,
    );
    expect(result.ok).toBe(true);
  });
});

describe("validateQuizLinkRequest", () => {
  it("normalizes the URL and accepts a valid window", () => {
    const result = validateQuizLinkRequest({
      quiz: "  https://example.com/api/files/q  ",
      start: "1000",
      end: "2000",
    });
    expect(result).toEqual({
      ok: true,
      payload: { quiz: "https://example.com/api/files/q", start: 1000, end: 2000 },
    });
  });

  it.each([
    ["non-http(s) scheme", { quiz: "ftp://x/q", start: "1000", end: "2000" }],
    ["not a URL", { quiz: "not a url", start: "1000", end: "2000" }],
  ])("rejects an invalid URL: %s", (_label, input) => {
    const result = validateQuizLinkRequest(input);
    expect(result.ok).toBe(false);
  });

  it("rejects end <= start", () => {
    const result = validateQuizLinkRequest({
      quiz: "https://x/q",
      start: "2000",
      end: "2000",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects non-digit timestamps", () => {
    const result = validateQuizLinkRequest({ quiz: "https://x/q", start: "soon", end: "later" });
    expect(result.ok).toBe(false);
  });
});

describe("getQuizLinkSecret", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetQuizLinkSecretForTests();
  });

  it("throws when AUTH_SECRET is not set", () => {
    resetQuizLinkSecretForTests();
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => getQuizLinkSecret()).toThrow(/AUTH_SECRET/);
  });

  it("derives a stable, purpose-bound key (not AUTH_SECRET itself)", () => {
    resetQuizLinkSecretForTests();
    vi.stubEnv("AUTH_SECRET", "the-auth-secret");
    const first = getQuizLinkSecret();
    expect(first).not.toBe("the-auth-secret");
    expect(getQuizLinkSecret()).toBe(first);
  });
});
