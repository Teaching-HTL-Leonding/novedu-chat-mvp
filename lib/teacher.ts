import type { Profile } from "next-auth";

/**
 * Teacher status is derived from the Microsoft Entra `groups` claim. In the
 * Auth.js `jwt` callback the `profile` argument is the decoded ID token, so the
 * `groups` array (when Entra is configured to emit it) is available directly as
 * `profile.groups` — no manual JWT decoding required.
 *
 * Overage: when a user belongs to too many groups to fit in the token, Entra
 * drops the `groups` array and substitutes a `_claim_names` / `_claim_sources`
 * pointer. Membership then cannot be decided from the token alone — resolving it
 * would require a Microsoft Graph call. We surface that via `overage` and fail
 * closed (not a teacher) until such a lookup is implemented.
 */
export function resolveTeacher(
  profile: Profile | undefined,
  teacherGroupId: string,
): { isTeacher: boolean; overage: boolean } {
  if (!profile) return { isTeacher: false, overage: false };
  const overage = "_claim_names" in profile || "_claim_sources" in profile;
  const groups = profile.groups;
  const isTeacher = Array.isArray(groups) && groups.includes(teacherGroupId);
  return { isTeacher, overage };
}
