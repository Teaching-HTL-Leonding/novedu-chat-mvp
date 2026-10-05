import { decodeJwtPayload } from "@/lib/teacher";

/**
 * The person's given name from the Microsoft Entra `given_name` claim on the ID
 * token — an optional claim the app registration must request (with the Graph
 * `profile` permission; docs/azure-runtime-env.md). The account hook in
 * `auth.ts` writes it to `novedu_user.given_name` on every sign-in; the start
 * page greets with it.
 *
 * `null` when the token is malformed or carries no non-empty `given_name`
 * string. Pure and signature-blind, like `lib/teacher.ts`.
 */
export function givenNameFromIdToken(idToken: string): string | null {
  const claim = decodeJwtPayload(idToken)?.given_name;
  if (typeof claim !== "string") return null;
  return claim.trim() || null;
}
