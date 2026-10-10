import "server-only";

import { eq } from "drizzle-orm";
import type { AuthModeBlock } from "@/lib/auth-options-merge";
import { getDb } from "@/lib/db";
import { authUsers } from "@/lib/db/auth-schema";
import { givenNameFromIdToken } from "@/lib/given-name";
import { requiredEnv } from "@/lib/required-env";
import { teacherFromIdToken } from "@/lib/teacher";
import { recordError } from "@/lib/telemetry";

/**
 * The SERVER-OWNED user fields that come from the ID token, recomputed on every
 * sign-in and written to `novedu_user` in one update:
 *
 *  - `is_teacher` — membership of `teacherGroupId` in the `groups` claim.
 *  - `given_name` — the `given_name` claim (NULL without one); the start page
 *    greets with it.
 *
 * `input: false` in auth.ts keeps both off every API surface, and in an Entra build
 * this hook is their only writer. It has to be: better-auth drops `input: false`
 * fields from `mapProfileToUser`'s result, so the provider mapping cannot set them.
 *
 * It runs on the account row (created on the first sign-in of an identity,
 * updated on every later one), where better-auth has just stored the fresh
 * `id_token` — and it runs BEFORE the session is created, so the very next
 * `getSession` already reflects the new values.
 *
 * Everything is wrapped: a failure here must never block sign-in. Both fields
 * then keep their previous values, which for a new user is non-teacher (fail
 * closed) and no given name.
 */
function idTokenClaimsHook(teacherGroupId: string) {
  return async (account: { userId: string; idToken?: string | null }) => {
    try {
      if (typeof account.idToken !== "string") return;
      const { isTeacher, overage } = teacherFromIdToken(account.idToken, teacherGroupId);
      if (overage) {
        console.warn(
          "[auth] Entra returned a group overage claim; teacher status cannot be derived " +
            "from the token and defaults to non-teacher. A Microsoft Graph lookup would be " +
            "required to resolve membership for this user.",
        );
      }
      const givenName = givenNameFromIdToken(account.idToken);
      await getDb()
        .update(authUsers)
        .set({ isTeacher, givenName })
        .where(eq(authUsers.id, account.userId));
    } catch (error) {
      recordError(error, { "novedu.auth.stage": "apply-id-token-claims" });
      console.error("[auth] applying the ID token claims failed", error);
    }
  };
}

/**
 * The Entra build's sign-in: Microsoft Entra ID (single tenant) as the only
 * provider. A factory, so nothing here is read at module load — a demo build never
 * calls it and needs none of these settings. The credentials live in `.env` under
 * the app's own AZURE_* names; the teacher group is `TEACHER_GROUP_ID`
 * (tenant-specific configuration, not a secret).
 */
export function entraAuthOptions(): AuthModeBlock {
  const applyIdTokenClaims = idTokenClaimsHook(requiredEnv("TEACHER_GROUP_ID"));
  return {
    socialProviders: {
      microsoft: {
        clientId: requiredEnv("AZURE_CLIENT_ID"),
        clientSecret: requiredEnv("AZURE_CLIENT_SECRET"),
        tenantId: requiredEnv("AZURE_TENANT_ID"),
        // Require fresh Entra authentication when starting a session on a shared
        // computer, even if the previous user's Microsoft SSO session is still active.
        prompt: "login",
        // The Entra profile is authoritative for the display name and email: both
        // are overwritten on every sign-in.
        overrideUserInfoOnSignIn: true,
        // No avatars anywhere in the app — the user menu renders initials — so the
        // provider's Microsoft Graph photo fetch (an untimed extra request on every
        // callback) is skipped entirely.
        disableProfilePhoto: true,
        // The provider spreads this over `{ name, email, image, emailVerified }`,
        // both when it creates the user and on the `overrideUserInfoOnSignIn`
        // update, so these three fields are what every sign-in writes.
        mapProfileToUser: (profile) => ({
          // `novedu_user.name` is NOT NULL and every name fallback in the app
          // (`??`, `COALESCE`) treats an empty string as a real name, so a profile
          // without a `name` claim must not store `""`.
          name: profile.name?.trim() || profile.preferred_username || profile.email || profile.oid,
          // A profile with no `email` claim would otherwise be rejected with
          // EMAIL_NOT_FOUND; `preferred_username` is the tenant-unique UPN.
          email: profile.email ?? profile.preferred_username ?? `${profile.oid}@entra.invalid`,
          // A NULL is what clears the column; `undefined` would leave whatever the
          // provider supplied in place. better-auth types the mapped `image` as
          // `string | undefined`, hence the cast.
          image: null as unknown as string,
        }),
      },
    },
    account: {
      // One person, one `novedu_user` row: an Entra identity whose `oid` is not yet
      // in `novedu_account` links to the existing user row with the same email
      // instead of creating a second one. BOTH options are needed
      // (`oauth2/link-account.mjs`): Entra ID tokens carry no `email_verified`
      // claim, and the app's own rows have `email_verified = false`.
      //
      // SAFE ONLY WHILE THE ENTRA APP IS SINGLE-TENANT — the tenant owns every
      // email it can present. Revisit before admitting a second tenant, where one
      // tenant could claim another's address.
      accountLinking: {
        trustedProviders: ["microsoft"],
        requireLocalEmailVerified: false,
      },
    },
    databaseHooks: {
      account: {
        create: { after: applyIdTokenClaims },
        update: { after: applyIdTokenClaims },
      },
    },
  };
}
