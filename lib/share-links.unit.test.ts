import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  buildShareLink,
  canonicalPayload,
  type SharePayload,
  signSharePayload,
  validateShareRequest,
  verifyShareLink,
} from "./share-links";

const SECRET = "test-secret";
const TUTOR = "https://example.com/tutors/simple-tutor.yaml";
const PAYLOAD: SharePayload = { tutor: TUTOR, start: 1_700_000_000, end: 1_700_003_600 };
const IN_WINDOW = 1_700_001_800;
// What a successful verification of PAYLOAD returns (the sig is echoed back).
const VERIFIED = { ok: true, sig: signSharePayload(PAYLOAD, SECRET), ...PAYLOAD };

function params(overrides: Partial<Record<"tutor" | "start" | "end" | "sig", unknown>> = {}) {
  return {
    tutor: TUTOR,
    start: String(PAYLOAD.start),
    end: String(PAYLOAD.end),
    sig: signSharePayload(PAYLOAD, SECRET),
    ...overrides,
  };
}

describe("canonicalPayload / signSharePayload", () => {
  test("signs the exact documented string with HMAC-SHA256", () => {
    const canonical = `tutor=${TUTOR}&start=${PAYLOAD.start}&end=${PAYLOAD.end}`;
    expect(canonicalPayload(PAYLOAD)).toBe(canonical);
    expect(signSharePayload(PAYLOAD, SECRET)).toBe(
      createHmac("sha256", SECRET).update(canonical).digest("hex"),
    );
  });

  test("different secrets produce different signatures", () => {
    expect(signSharePayload(PAYLOAD, "a")).not.toBe(signSharePayload(PAYLOAD, "b"));
  });
});

describe("buildShareLink", () => {
  test("produces a link whose parameters verify", () => {
    const link = buildShareLink("https://app.example.org/", PAYLOAD, SECRET);
    const url = new URL(link);
    expect(url.origin).toBe("https://app.example.org");
    const result = verifyShareLink(
      {
        tutor: url.searchParams.get("tutor"),
        start: url.searchParams.get("start"),
        end: url.searchParams.get("end"),
        sig: url.searchParams.get("sig"),
      },
      SECRET,
      IN_WINDOW,
    );
    expect(result).toEqual(VERIFIED);
  });

  test("URL-encodes the tutor parameter", () => {
    const tutor = "https://example.com/a tutor.yaml?x=1&y=2";
    const link = buildShareLink("http://localhost:3000/", { ...PAYLOAD, tutor }, SECRET);
    // The raw (decoded) value round-trips through URL encoding.
    expect(new URL(link).searchParams.get("tutor")).toBe(tutor);
  });
});

describe("verifyShareLink", () => {
  test("accepts a valid link inside the window and echoes the sig", () => {
    expect(verifyShareLink(params(), SECRET, IN_WINDOW)).toEqual(VERIFIED);
  });

  test("the window bounds are inclusive", () => {
    expect(verifyShareLink(params(), SECRET, PAYLOAD.start).ok).toBe(true);
    expect(verifyShareLink(params(), SECRET, PAYLOAD.end).ok).toBe(true);
  });

  test("rejects just outside the window with the right reasons", () => {
    expect(verifyShareLink(params(), SECRET, PAYLOAD.start - 1)).toMatchObject({
      ok: false,
      reason: "not-started",
      start: PAYLOAD.start,
      end: PAYLOAD.end,
    });
    expect(verifyShareLink(params(), SECRET, PAYLOAD.end + 1)).toMatchObject({
      ok: false,
      reason: "expired",
      start: PAYLOAD.start,
      end: PAYLOAD.end,
    });
  });

  test.each(["tutor", "start", "end", "sig"] as const)("rejects a missing %s parameter", (name) => {
    expect(verifyShareLink(params({ [name]: undefined }), SECRET, IN_WINDOW)).toEqual({
      ok: false,
      reason: "missing-params",
    });
  });

  test("rejects empty tutor and sig values", () => {
    expect(verifyShareLink(params({ tutor: "" }), SECRET, IN_WINDOW).ok).toBe(false);
    expect(verifyShareLink(params({ sig: "" }), SECRET, IN_WINDOW).ok).toBe(false);
  });

  test("rejects non-numeric timestamps before touching the signature", () => {
    for (const override of [{ start: "tomorrow" }, { end: "-5" }, { start: "1.5" }]) {
      expect(verifyShareLink(params(override), SECRET, IN_WINDOW)).toEqual({
        ok: false,
        reason: "missing-params",
      });
    }
  });

  test.each([
    ["tutor", { tutor: "https://evil.example.com/other.yaml" }],
    ["start", { start: String(PAYLOAD.start - 3600) }],
    ["end", { end: String(PAYLOAD.end + 3600) }],
  ])("rejects a tampered %s parameter", (_name, override) => {
    expect(verifyShareLink(params(override), SECRET, IN_WINDOW)).toEqual({
      ok: false,
      reason: "invalid-signature",
    });
  });

  test("rejects a signature made with a different secret", () => {
    const sig = signSharePayload(PAYLOAD, "other-secret");
    expect(verifyShareLink(params({ sig }), SECRET, IN_WINDOW)).toEqual({
      ok: false,
      reason: "invalid-signature",
    });
  });

  test("rejects malformed signatures without throwing", () => {
    const valid = signSharePayload(PAYLOAD, SECRET);
    for (const sig of [
      "zz",
      valid.slice(0, -2), // truncated
      `${valid}ab`, // extended
      `${valid}zz`, // valid hex followed by junk (Buffer.from would silently stop)
      valid.toUpperCase(), // hex is case-insensitive — uppercase must still verify
    ]) {
      const result = verifyShareLink(params({ sig }), SECRET, IN_WINDOW);
      if (sig === valid.toUpperCase()) {
        expect(result.ok).toBe(true);
      } else {
        expect(result).toEqual({ ok: false, reason: "invalid-signature" });
      }
    }
  });

  test("an expired/not-started link still requires a valid signature first", () => {
    // Tampering with `end` to push the window must NOT yield "expired" — the
    // signature check has to win.
    const result = verifyShareLink(
      params({ end: String(PAYLOAD.end + 9999) }),
      SECRET,
      PAYLOAD.end + 5000,
    );
    expect(result).toEqual({ ok: false, reason: "invalid-signature" });
  });
});

describe("validateShareRequest", () => {
  const valid = {
    tutor: TUTOR,
    start: String(PAYLOAD.start),
    end: String(PAYLOAD.end),
  };

  test("accepts a valid request and parses the timestamps", () => {
    expect(validateShareRequest(valid)).toEqual({ ok: true, payload: PAYLOAD });
  });

  test("trims the tutor URL", () => {
    const result = validateShareRequest({ ...valid, tutor: `  ${TUTOR}  ` });
    expect(result).toEqual({ ok: true, payload: PAYLOAD });
  });

  test("normalizes the tutor URL to its ASCII href form", () => {
    // Non-ASCII characters must be percent-encoded at signing time: the URL is
    // later sent as an HTTP header, and header values must be Latin-1. The
    // normalized form is what gets signed AND what the link carries, so
    // verification stays consistent.
    const result = validateShareRequest({ ...valid, tutor: "https://example.com/tütor ü.yaml" });
    expect(result).toEqual({
      ok: true,
      payload: { ...PAYLOAD, tutor: "https://example.com/t%C3%BCtor%20%C3%BC.yaml" },
    });
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting ASCII-only
    if (result.ok) expect(/^[\x00-\x7F]+$/.test(result.payload.tutor)).toBe(true);
  });

  test("rejects non-http(s) and malformed tutor URLs", () => {
    for (const tutor of ["", "ftp://example.com/t.yaml", "javascript:alert(1)", "not a url", 42]) {
      expect(validateShareRequest({ ...valid, tutor }).ok).toBe(false);
    }
  });

  test("rejects missing or non-numeric timestamps", () => {
    expect(validateShareRequest({ ...valid, start: null }).ok).toBe(false);
    expect(validateShareRequest({ ...valid, start: "" }).ok).toBe(false);
    expect(validateShareRequest({ ...valid, end: "NaN" }).ok).toBe(false);
    expect(validateShareRequest({ ...valid, end: "-1" }).ok).toBe(false);
  });

  test("rejects a window that ends before (or exactly when) it starts", () => {
    expect(validateShareRequest({ ...valid, end: String(PAYLOAD.start) }).ok).toBe(false);
    expect(validateShareRequest({ ...valid, end: String(PAYLOAD.start - 60) }).ok).toBe(false);
  });
});
