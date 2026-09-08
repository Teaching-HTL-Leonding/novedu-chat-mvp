/**
 * Teacher status is derived from the Microsoft Entra `groups` claim on the ID
 * token. The token is stored on the account row at sign-in, so the flag is
 * recomputed from it on every sign-in (see `auth.ts`).
 *
 * Overage: when a user belongs to too many groups to fit in the token, Entra
 * drops the `groups` array and substitutes a `_claim_names` / `_claim_sources`
 * pointer. Membership then cannot be decided from the token alone — resolving it
 * would require a Microsoft Graph call. We surface that via `overage` and fail
 * closed (not a teacher) until such a lookup is implemented.
 *
 * This module is pure: no database, no crypto library, no app imports. The ID
 * token arrives over TLS straight from the Entra token endpoint (the provider
 * already established that provenance), so the payload is read without a
 * signature check — nothing here trusts a token from any other source.
 */

export function resolveTeacher(
  claims: Record<string, unknown> | undefined,
  teacherGroupId: string,
): { isTeacher: boolean; overage: boolean } {
  if (!claims) return { isTeacher: false, overage: false };
  const overage = "_claim_names" in claims || "_claim_sources" in claims;
  const groups = claims.groups;
  const isTeacher = Array.isArray(groups) && groups.includes(teacherGroupId);
  return { isTeacher, overage };
}

/**
 * The payload segment of a JWT as a plain object, or `null` when the string is
 * not a well-formed JWT with a JSON object payload. Deliberately dependency-free
 * (no `jose`) and signature-blind — see the module comment.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const segment = token.split(".")[1];
    if (!segment) return null;
    const json = Buffer.from(segment, "base64url").toString("utf8");
    const payload: unknown = JSON.parse(json);
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** `resolveTeacher` over an ID token — the form the account row stores. */
export function teacherFromIdToken(
  idToken: string,
  teacherGroupId: string,
): { isTeacher: boolean; overage: boolean } {
  return resolveTeacher(decodeJwtPayload(idToken) ?? undefined, teacherGroupId);
}
