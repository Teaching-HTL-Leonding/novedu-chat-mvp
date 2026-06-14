import { createHmac, timingSafeEqual } from "node:crypto";

// Thread-ownership tokens: the chat page (app/[code]/page.tsx) generates the
// Mastra thread id server-side and signs (code, userId, threadId); the chat
// runtime route refuses any thread-touching request whose token does not match
// the requesting user's session. This is what keeps students from reading or
// continuing each other's chats — Mastra itself does NOT bind threads to a
// resource (its getThreadById ignores the resourceId and saveThread silently
// rebinds it), and storing an ownership table would break the anonymity
// promise for `anonymous: true` tutors. A stateless HMAC proves ownership
// without persisting anything.
//
// Pure functions — the secret is always passed in — so sign/verify are
// unit-testable; `getThreadTokenSecret()` is the production secret.
//
// SERVER-ONLY: uses node:crypto and handles the signing secret. Never import
// from client components.

export interface ThreadTokenPayload {
  /** The tutor code the chat was opened under. */
  code: string;
  /** Session user id (Entra `oid`) of the signed-in student. */
  userId: string;
  /** The server-generated Mastra thread id. */
  threadId: string;
}

// JSON-encoding the triple as an array is injective for arbitrary strings —
// no separator can collide with content (the session user id is treated as
// opaque; do not assume it avoids any particular character).
export function canonicalThreadPayload({ code, userId, threadId }: ThreadTokenPayload): string {
  return JSON.stringify([code, userId, threadId]);
}

export function signThreadToken(payload: ThreadTokenPayload, secret: string): string {
  return createHmac("sha256", secret).update(canonicalThreadPayload(payload)).digest("hex");
}

function safeEqualHex(candidate: string, expected: string): boolean {
  // Reject non-hex up front: Buffer.from(.., "hex") silently stops at the first
  // invalid character, which would otherwise accept e.g. `<sig>zz`.
  if (!/^[0-9a-f]+$/i.test(candidate)) return false;
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verifies a token (typically the client-sent `x-thread-token` header, so
 * `unknown`) against the payload the SERVER believes in — in particular the
 * userId always comes from the current session, which is why a leaked
 * token+threadId pair is useless to anyone but its owner.
 */
export function verifyThreadToken(
  token: unknown,
  payload: ThreadTokenPayload,
  secret: string,
): boolean {
  if (typeof token !== "string" || token === "") return false;
  return safeEqualHex(token, signThreadToken(payload, secret));
}

// Purpose-bound key derived from AUTH_SECRET (already required by Auth.js, so
// no extra ops configuration) — the derivation keeps thread tokens in their
// own key domain instead of signing with the session secret directly.
let cachedSecret: string | undefined;

export function getThreadTokenSecret(): string {
  if (cachedSecret !== undefined) return cachedSecret;
  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) {
    throw new Error("AUTH_SECRET is not set — required to sign thread-ownership tokens");
  }
  cachedSecret = createHmac("sha256", authSecret).update("novedu:thread-token:v1").digest("hex");
  return cachedSecret;
}

/** Clears the memoized secret — for unit tests only. */
export function resetThreadTokenSecretForTests(): void {
  cachedSecret = undefined;
}
