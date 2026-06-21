import { createHmac, timingSafeEqual } from "node:crypto";

// Core of the QUIZ share-link feature: a teacher hands students a deep link to
// the quiz runner (`/q?quiz=...&start=...&end=...&sig=...`) whose parameters are
// protected by an HMAC-SHA256 signature, so a student can neither point the
// runner at an arbitrary YAML nor stretch the availability window. This revives
// the app's original tutor share-link mechanism (removed when tutor codes
// landed), now keyed for quizzes and signed with an AUTH_SECRET-derived key.
//
// Pure functions — the secret is always passed in — so sign/verify are
// unit-testable and reusable from the share action, the `/q` page, the
// `submitAnswer`/`startDiscussion` actions, the runtime route, and the e2e
// suite. `getQuizLinkSecret()` is the production secret.
//
// SERVER-ONLY: uses node:crypto and handles the signing secret. Never import
// from client components.

export interface QuizLinkPayload {
  /** Public URL of the quiz-definition YAML (normalized to `URL.href`). */
  quiz: string;
  /** Window start, unix seconds (UTC). */
  start: number;
  /** Window end, unix seconds (UTC). */
  end: number;
}

// The exact string that is signed. Raw (un-encoded) values by design: both sides
// sign the DECODED parameter values, so URL encoding never has to match.
//
// NOTE: this format is injective ONLY because start/end are validated against
// TIMESTAMP_PATTERN (digits only) BEFORE signing and BEFORE verifying. That
// rules out re-splitting a quiz URL that itself contains "&start=": the
// alternative split would have to absorb "&start=..." into the end value, which
// then fails the digit check. Keep the pattern checks ahead of the HMAC on both
// sides.
export function canonicalQuizPayload({ quiz, start, end }: QuizLinkPayload): string {
  return `quiz=${quiz}&start=${start}&end=${end}`;
}

export function signQuizPayload(payload: QuizLinkPayload, secret: string): string {
  return createHmac("sha256", secret).update(canonicalQuizPayload(payload)).digest("hex");
}

/** Builds the full deep link to the quiz runner for a signed payload. */
export function buildQuizLink(origin: string, payload: QuizLinkPayload, secret: string): string {
  const url = new URL("/q", origin || "http://localhost");
  url.searchParams.set("quiz", payload.quiz);
  url.searchParams.set("start", String(payload.start));
  url.searchParams.set("end", String(payload.end));
  url.searchParams.set("sig", signQuizPayload(payload, secret));
  // Root-relative when no origin was resolved (origin === ""), absolute otherwise.
  return origin ? url.toString() : `${url.pathname}${url.search}`;
}

export type QuizLinkVerification =
  // Success echoes the verified sig so callers can forward the exact parameter
  // set (e.g. as chat-runtime headers) without re-reading the request.
  | ({ ok: true; sig: string } & QuizLinkPayload)
  // A parameter is absent, empty, or malformed — most likely the runner was
  // opened without a (complete) quiz link.
  | { ok: false; reason: "missing-params" }
  // The signature does not match the parameters — tampered or truncated link.
  | { ok: false; reason: "invalid-signature" }
  // Signature is valid but "now" is outside the signed window; the bounds are
  // included so the UI can say WHEN the link opens/closed, in local time.
  | { ok: false; reason: "not-started" | "expired"; start: number; end: number };

export type QuizLinkRejection = Extract<QuizLinkVerification, { ok: false }>["reason"];

/**
 * A short human-readable message for a rejected quiz link, for the server
 * actions that surface a single string (the `/q` page uses the richer
 * `QuizLinkError` view with the window bounds instead).
 */
export function quizLinkRejectionMessage(reason: QuizLinkRejection): string {
  switch (reason) {
    case "missing-params":
      return "This quiz can only be opened through a valid quiz link.";
    case "invalid-signature":
      return "This quiz link is invalid or has been modified. Ask your teacher for a new link.";
    case "not-started":
      return "This quiz is not available yet.";
    case "expired":
      return "This quiz link has expired. Ask your teacher for a new link.";
  }
}

// Unix-seconds values are 10 digits today; 15 caps far beyond year 9999 while
// staying well inside Number.isSafeInteger territory. Also load-bearing for the
// canonical string's injectivity — see canonicalQuizPayload.
const TIMESTAMP_PATTERN = /^\d{1,15}$/;

function safeEqualHex(candidate: string, expected: string): boolean {
  // Reject non-hex up front: Buffer.from(.., "hex") silently stops at the first
  // invalid character, which would otherwise accept e.g. `<sig>zz`.
  if (!/^[0-9a-f]+$/i.test(candidate)) return false;
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verifies the four deep-link parameters (as decoded strings) against the
 * signing secret and the current time. `nowSeconds` is injected for testability;
 * callers pass `Math.floor(Date.now() / 1000)`. Both window bounds are inclusive.
 */
export function verifyQuizLink(
  params: { quiz?: unknown; start?: unknown; end?: unknown; sig?: unknown },
  secret: string,
  nowSeconds: number,
): QuizLinkVerification {
  const { quiz, start, end, sig } = params;
  if (
    typeof quiz !== "string" ||
    typeof start !== "string" ||
    typeof end !== "string" ||
    typeof sig !== "string" ||
    quiz === "" ||
    sig === "" ||
    !TIMESTAMP_PATTERN.test(start) ||
    !TIMESTAMP_PATTERN.test(end)
  ) {
    return { ok: false, reason: "missing-params" };
  }

  const payload: QuizLinkPayload = { quiz, start: Number(start), end: Number(end) };
  if (!safeEqualHex(sig, signQuizPayload(payload, secret))) {
    return { ok: false, reason: "invalid-signature" };
  }

  if (nowSeconds < payload.start) {
    return { ok: false, reason: "not-started", start: payload.start, end: payload.end };
  }
  if (nowSeconds > payload.end) {
    return { ok: false, reason: "expired", start: payload.start, end: payload.end };
  }
  return { ok: true, sig, ...payload };
}

export type QuizLinkRequestValidation =
  | { ok: true; payload: QuizLinkPayload }
  | { ok: false; message: string };

/**
 * Validates a teacher's raw "create quiz link" form input (quiz URL string,
 * start/end as unix-second strings). Pure so the server action stays a thin,
 * auth-handling shell around it.
 *
 * The quiz URL is NORMALIZED to `URL.href` before it goes into the payload: that
 * percent-encodes non-ASCII characters, which matters because the URL is later
 * sent as an HTTP header (header values must be Latin-1 — a raw unicode URL
 * would make every chat-runtime fetch throw in the browser). Signing and
 * verification both see the normalized form, so they stay consistent.
 */
export function validateQuizLinkRequest(input: {
  quiz: unknown;
  start: unknown;
  end: unknown;
}): QuizLinkRequestValidation {
  let url: URL;
  try {
    url = new URL(typeof input.quiz === "string" ? input.quiz.trim() : "");
  } catch {
    return { ok: false, message: "Provide a public http(s) URL to a quiz YAML file." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, message: "Provide a public http(s) URL to a quiz YAML file." };
  }

  const start = typeof input.start === "string" ? input.start : "";
  const end = typeof input.end === "string" ? input.end : "";
  if (!TIMESTAMP_PATTERN.test(start) || !TIMESTAMP_PATTERN.test(end)) {
    return { ok: false, message: "Pick both a start and an end date and time." };
  }
  const payload: QuizLinkPayload = { quiz: url.href, start: Number(start), end: Number(end) };
  if (payload.end <= payload.start) {
    return { ok: false, message: "The end of the availability window must be after its start." };
  }
  return { ok: true, payload };
}

// Purpose-bound key derived from AUTH_SECRET (already required by Auth.js, so no
// extra ops configuration) — the derivation keeps quiz-link signatures in their
// own key domain instead of signing with the session secret directly. Mirrors
// `lib/thread-token.ts`; deliberately does NOT revive the old `SHARE_LINK_SECRET`
// env var.
let cachedSecret: string | undefined;

export function getQuizLinkSecret(): string {
  if (cachedSecret !== undefined) return cachedSecret;
  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) {
    throw new Error("AUTH_SECRET is not set — required to sign quiz links");
  }
  cachedSecret = createHmac("sha256", authSecret).update("novedu:quiz-link:v1").digest("hex");
  return cachedSecret;
}

/** Clears the memoized secret — for unit tests only. */
export function resetQuizLinkSecretForTests(): void {
  cachedSecret = undefined;
}
